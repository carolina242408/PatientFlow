"""Real HTTP/JWT/WebSocket checks for the isolated MVP stack (Python stdlib only)."""
import base64
import hashlib
import json
import os
import socket
import struct
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def request(url, token=None, method="GET", body=None, status=200, form=False):
    headers = {}
    if token:
        headers["Authorization"] = "Bearer " + token
    data = None
    if body is not None:
        data = (urllib.parse.urlencode(body) if form else json.dumps(body)).encode()
        headers["Content-Type"] = "application/x-www-form-urlencoded" if form else "application/json"
    try:
        response = urllib.request.urlopen(urllib.request.Request(url, data, headers, method=method), timeout=15)
    except urllib.error.HTTPError as error:
        response = error
    with response:
        raw = response.read().decode()
        check(response.status == status, f"{method} {urllib.parse.urlsplit(url).path}: expected {status}, got {response.status}: {raw[:600]}")
        return json.loads(raw) if raw and response.headers.get_content_type().endswith("json") else raw


def wait_ready(url, timeout=180):
    deadline = time.monotonic() + timeout
    while True:
        try:
            return request(url)
        except (OSError, AssertionError):
            if time.monotonic() >= deadline:
                raise TimeoutError("Service did not become ready: " + url)
            time.sleep(1)


class Events:
    """Small RFC6455 client: validates upgrade, handles frames and never logs tickets."""
    def __init__(self, backend, ticket):
        parsed = urllib.parse.urlsplit(backend)
        self.connection = socket.create_connection((parsed.hostname, parsed.port), timeout=15)
        self.connection.settimeout(15)
        self.stream = self.connection.makefile("rb")
        key = base64.b64encode(os.urandom(16)).decode()
        path = "/ws/events?" + urllib.parse.urlencode({"ticket": ticket})
        self.connection.sendall((f"GET {path} HTTP/1.1\r\nHost: {parsed.netloc}\r\nOrigin: {backend}\r\n"
                                 f"Upgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
                                 "Sec-WebSocket-Version: 13\r\n\r\n").encode())
        status = self.stream.readline().decode()
        check(" 101 " in status, "WebSocket upgrade failed: " + status)
        headers = {}
        while line := self.stream.readline().decode().strip():
            name, value = line.split(":", 1)
            headers[name.lower()] = value.strip()
        accept = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        check(headers.get("sec-websocket-accept") == accept, "Invalid WebSocket handshake")

    def exact(self, length):
        value = self.stream.read(length)
        check(len(value) == length, "Unexpected WebSocket EOF")
        return value

    def frame(self):
        first, second = self.exact(2)
        length = second & 127
        if length == 126:
            length = struct.unpack("!H", self.exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self.exact(8))[0]
        check(not second & 128 and first & 128, "Expected complete, unmasked server frame")
        return first & 15, self.exact(length)

    def event(self, event_type):
        for _ in range(30):
            opcode, payload = self.frame()
            check(opcode == 1, "Expected event, received WebSocket control frame")
            value = json.loads(payload)
            if value.get("type") == event_type:
                return value
        raise AssertionError("Event not received: " + event_type)

    def revoked(self):
        for _ in range(30):
            opcode, payload = self.frame()
            if opcode == 8:
                check(struct.unpack("!H", payload[:2])[0] == 1008, "Revocation must close with policy violation")
                return
        raise AssertionError("Revoked connection remained open")

    def close(self):
        self.stream.close()
        self.connection.close()


def login(keycloak, username):
    return request(keycloak + "/realms/patientflow/protocol/openid-connect/token", method="POST", form=True,
                   body={"grant_type": "password", "client_id": "backend_demo", "username": username,
                         "password": username})["access_token"]


def api_snapshot(api, token):
    return {"indicators": request(api + "/analytics/indicators", token),
            "alerts": request(api + "/analytics/alerts", token),
            "map": request(api + "/bed-map?size=10", token),
            "forecast": request(api + "/analytics/occupancy-forecast?size=10", token)}


def degraded(backend, keycloak, report):
    token = login(keycloak, "demo-admin")
    data = api_snapshot(backend + "/api", token)
    engine = data["forecast"]["engine"]
    check(engine["source"] == "BACKEND_BASELINE" and engine["degraded"], "Expected operational local fallback")
    check(data["indicators"]["beds"]["total"] == 24, "Demo data changed after restart")
    check(data["indicators"]["waiting"]["pending"] == 8, "Restart restored/duplicated processed requests")
    report.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print("PASS: algorithms unavailable; local fallback and persisted operational state", flush=True)


def run(backend, keycloak, report):
    wait_ready(keycloak + "/realms/patientflow/.well-known/openid-configuration")
    wait_ready(backend + "/actuator/health")
    api = backend + "/api"
    users = {name: login(keycloak, "demo-" + name) for name in ["admin", "unit", "service", "other", "lhu"]}
    print("PASS: backend health and five real Keycloak logins", flush=True)
    admin = users["admin"]
    request(api + "/bed-map", status=401)
    for name in ["unit", "service", "other", "lhu"]:
        request(api + "/analytics/indicators", users[name], status=403)
    units = request(api + "/hierarchy/UNIT", admin)["content"]
    centro = next(n for n in units if n["name"] == "Hospital Demonstração Centro")
    norte = next(n for n in units if n["name"] == "Hospital Demonstração Norte")
    services = request(api + "/hierarchy/SERVICE", admin)["content"]
    pressure = next(n for n in services if n["code"] == "DEMO-MED")
    recovery = next(n for n in services if n["code"] == "DEMO-ORT")
    scopes = [("unit", "UNIT", centro["id"]), ("other", "UNIT", norte["id"]),
              ("service", "SERVICE", pressure["id"]), ("lhu", "ULS", centro["parentId"])]
    created = {}
    for name, kind, scope in scopes:
        me = request(api + "/access/me", users[name])
        check(not me["administrator"] and me["scopes"] == [], "Unexpected automatic scope grant")
        created[name] = request(api + "/access/grants", admin, "POST",
                                {"subject": me["subject"], "type": kind, "scopeId": scope}, 201)
    all_data = api_snapshot(api, admin)
    check(all_data["indicators"]["beds"]["total"] == 24, "Expected 24 synthetic beds")
    check(all_data["forecast"]["engine"]["source"] == "ALGORITHMS_SERVICE", "Python decision service was not used")
    for name, count in [("unit", 16), ("other", 6), ("service", 8), ("lhu", 22)]:
        value = request(api + "/analytics/indicators", users[name])
        check(value["beds"]["total"] == count, "Incorrect organizational total for " + name)
    value = request(api + "/analytics/indicators", users["service"])
    check(value["beds"]["occupancyPercent"] == 100 and value["waiting"]["dueNow"] == 5, "Pressure scenario inconsistent")
    request(api + "/access/grants", users["unit"], status=403)
    outside = request(api + "/beds?unitId=" + norte["id"], admin)["content"][0]
    request(api + "/beds/" + outside["id"], users["unit"], status=404)
    check(request(api + "/beds?unitId=" + norte["id"], users["unit"])["totalElements"] == 0, "Scope filter escaped authorization")
    print("PASS: explicit grants, organizational isolation, pressure indicators and external algorithms", flush=True)
    socket_client = Events(backend, request(api + "/events/tickets", users["unit"], "POST")["ticket"])
    try:
        socket_client.event("RESYNC_REQUIRED")
        unique = uuid.uuid4().hex[:12]
        patient = request(api + "/patients", admin, "POST", {"snsNumber": "SMOKE-" + unique,
                          "fullName": "Doente sintético validação " + unique}, 201)
        queued = request(api + "/admission-requests", admin, "POST", {"requestNumber": "SMOKE-" + unique,
                         "patientId": patient["id"], "serviceId": recovery["id"], "origin": "EMERGENCY", "priority": 1}, 201)
        path = api + "/admission-requests/" + queued["id"]
        request(path, users["service"], status=404)
        suggestion = request(path + "/bed-suggestions", users["unit"])
        check(suggestion["engine"]["source"] == "ALGORITHMS_SERVICE" and suggestion["candidateCount"] == 3, "Bed ranking not integrated")
        bed_id = suggestion["recommendations"][0]["bedId"]
        admission = {"version": queued["version"], "bedId": bed_id, "visitNumber": "SMOKE-VISIT-" + unique}
        admitted = request(path + "/admit", users["unit"], "POST", admission)
        check(admitted["status"] == "ADMITTED", "Request not admitted")
        check(request(path + "/admit", users["unit"], "POST", admission)["encounterId"] == admitted["encounterId"], "Admission retry duplicated episode")
        socket_client.event("PATIENT_ADMITTED")
        encounter_path = api + "/encounters/" + admitted["encounterId"]
        encounter = request(encounter_path, users["unit"])
        expected = (datetime.now(timezone.utc) + timedelta(hours=12)).isoformat()
        encounter = request(encounter_path + "/discharge-plan", users["unit"], "PUT",
                            {"version": encounter["version"], "expectedDischargeAt": expected})
        encounter = request(encounter_path + "/clinical-discharge", users["unit"], "POST", {"version": encounter["version"]})
        check(request(api + "/beds/" + bed_id, users["unit"])["status"] == "OCCUPIED", "Clinical discharge released bed")
        encounter = request(encounter_path + "/administrative-discharge", users["unit"], "POST", {"version": encounter["version"]})
        check(encounter["status"] == "FINISHED", "Administrative discharge did not finish episode")
        bed = request(api + "/beds/" + bed_id, users["unit"])
        check(bed["status"] == "CLEANING", "Discharged bed skipped cleaning")
        cleaned = request(api + "/beds/" + bed_id + "/status", users["unit"], "PUT", {"status": "AVAILABLE", "version": bed["version"]})
        check(cleaned["status"] == "AVAILABLE", "Cleaning did not restore availability")
        history = request(api + "/allocations?encounterId=" + admitted["encounterId"], users["unit"])
        check(history["totalElements"] == 1 and history["content"][0]["dischargedAt"], "Allocation history incoherent")
        request(api + "/access/grants/" + created["unit"]["id"], admin, "DELETE", status=204)
        request(api + "/bed-map", users["unit"], status=403)
        socket_client.revoked()
    finally:
        socket_client.close()
    report.write_text(json.dumps(api_snapshot(api, admin), ensure_ascii=False, indent=2), encoding="utf-8")
    print("PASS: WebSocket events/revocation, admission/discharge/cleaning/history", flush=True)
    return {"requestId": queued["id"], "encounterId": admitted["encounterId"], "bedId": bed_id,
            "revokedSubject": created["unit"]["subject"]}


def persisted(backend, keycloak, state):
    """Check the completed operation and revocation survived the backend restart."""
    api = backend + "/api"
    admin = login(keycloak, "demo-admin")
    check(request(api + "/admission-requests/" + state["requestId"], admin)["status"] == "ADMITTED",
          "Processed request was lost or restored to waiting")
    encounter = request(api + "/encounters/" + state["encounterId"], admin)
    check(encounter["status"] == "FINISHED" and encounter["clinicalDischargeAt"] and encounter["administrativeDischargeAt"],
          "Discharged encounter was lost or reopened")
    check(request(api + "/beds/" + state["bedId"], admin)["status"] == "AVAILABLE", "Cleaning result was lost")
    check(request(api + "/access/grants?subject=" + state["revokedSubject"], admin) == [], "Revoked scope was restored")
    history = request(api + "/allocations?encounterId=" + state["encounterId"], admin)
    check(history["totalElements"] == 1 and history["content"][0]["dischargedAt"], "Allocation history changed after restart")
    print("PASS: processed request, discharged episode, cleaning, history and revoked access persisted after restart", flush=True)


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend", required=True, help="Backend origin, e.g. http://localhost:18080")
    parser.add_argument("--keycloak", required=True)
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--degraded", action="store_true")
    args = parser.parse_args()
    (degraded if args.degraded else run)(args.backend.rstrip("/"), args.keycloak.rstrip("/"), args.report)
