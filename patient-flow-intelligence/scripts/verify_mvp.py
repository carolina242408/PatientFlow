"""Build and validate a disposable MVP project; never uses development volumes."""
import argparse
import json
import os
import shutil
import socket
import subprocess
import uuid
from pathlib import Path

from smoke_mvp import degraded, persisted, run, wait_ready

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docker", default="docker", help="Docker executable")
    args = parser.parse_args()
    if not shutil.which(args.docker):
        parser.error("Executable unavailable: " + args.docker)
    project = "pfi-verify-" + uuid.uuid4().hex[:12]
    # Reserve two distinct loopback ports until the environment is ready to start.
    sockets = [socket.socket() for _ in range(2)]
    for connection in sockets:
        connection.bind(("127.0.0.1", 0))
    ports = [connection.getsockname()[1] for connection in sockets]
    env = {**os.environ, **dict(zip(["MVP_API_PORT", "MVP_KEYCLOAK_PORT"], map(str, ports)))}
    report = ROOT / ".validation" / project
    report.mkdir(parents=True, exist_ok=False)
    compose = [args.docker, "compose", "--env-file", ".env.example", "-f", "compose.mvp.yml", "-p", project]

    def command(*values):
        subprocess.run([*compose, *values], cwd=ROOT, env=env, check=True)

    backend, keycloak = ["http://localhost:" + str(port) for port in ports]
    try:
        subprocess.run([args.docker, "info", "--format", "{{.ServerVersion}}"], check=True, env=env)
        for connection in sockets:
            connection.close()
        print("Isolated validation project:", project, flush=True)
        command("up", "-d", "--build", "--wait", "--wait-timeout", "300")
        wait_ready(backend + "/actuator/health")
        state = run(backend, keycloak, report / "api-snapshot.json")
        command("exec", "-T", "-e", "ALGORITHMS_TEST_URL=http://localhost:8000", "algorithms",
                "python", "-m", "unittest", "discover", "-s", "tests", "-v")
        command("stop", "algorithms")
        degraded(backend, keycloak, report / "api-degraded.json")
        command("restart", "backend")
        wait_ready(backend + "/actuator/health")
        degraded(backend, keycloak, report / "api-after-restart.json")
        persisted(backend, keycloak, state)
        (report / "result.json").write_text(json.dumps({"project": project, "passed": True,
            "checks": ["backend-health", "real-keycloak", "scopes", "workflow", "websocket",
                       "algorithms-http", "fallback", "restart-idempotence", "persisted-workflow"]}, indent=2), encoding="utf-8")
        print("PASS: isolated MVP validation. Reports:", report, flush=True)
    except Exception:
        command("ps", "-a")
        command("logs", "--tail", "80", "backend", "keycloak", "algorithms")
        raise
    finally:
        for connection in sockets:
            connection.close()
        # Only this randomly named project is eligible for destructive cleanup.
        if not project.startswith("pfi-verify-") or len(project) != 23:
            raise RuntimeError("Refusing cleanup of an unexpected project")
        command("down", "--volumes", "--remove-orphans")


if __name__ == "__main__":
    main()
