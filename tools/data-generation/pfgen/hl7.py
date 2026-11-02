"""HL7 v2.5 ADT builder (A01 / A02 / A03) in the format of the sample messages.



Field-level rules required by the main application:



* MSH-10   a fresh UUID for every single message (never reused).

* PID-3    ``NS^^^HOS^NS~SNS^^^HAS^SNS`` built from the frozen identity, so

           an NS can never be emitted with another patient's data.

* PID-5    ``SURNAMES^FIRST^MIDDLE^^^^L`` from the *same* identity object.

* PID-18.1 Nº de processo clínico (``processo^^^HOS``), stable per patient.

* PV1-19   episode number (``YYnnnnnn^^^HOS``), stable within the episode.

"""

from __future__ import annotations

import random
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from .hospital import Bed, Hospital
from .identity import PatientIdentity, Staff, ascii_fold
from .simulation import AdtEvent

TS = "%Y%m%d%H%M%S"


def escape(value: str | None, accents: bool = True) -> str:
    """Escape HL7 delimiters and encode non-ASCII as \\XHH\\ (ISO-8859-1)."""

    if not value:
        return ""

    if not accents:
        value = ascii_fold(value)

    out = []

    for ch in value:
        if ch == "\\":
            out.append("\\E\\")

        elif ch == "|":
            out.append("\\F\\")

        elif ch == "^":
            out.append("\\S\\")

        elif ch == "&":
            out.append("\\T\\")

        elif ch == "~":
            out.append("\\R\\")

        elif ord(ch) > 127:
            try:
                out.append("\\X" + ch.encode("latin-1").hex().upper() + "\\")

            except UnicodeEncodeError:
                out.append(ascii_fold(ch) or "?")

        else:
            out.append(ch)

    return "".join(out)


def ts(value: datetime) -> str:

    return value.strftime(TS)


@dataclass
class RenderedMessage:
    control_id: str  # MSH-10

    trigger: str

    msh_time: datetime  # MSH-7

    recorded: datetime  # EVN-2

    occurred: datetime  # EVN-6 (real movement time)

    text: str

    ns: str

    processo: str

    episode: str

    event: AdtEvent


class HL7Builder:
    def __init__(self, hospital: Hospital, hl7_cfg: dict, rng: random.Random):

        self.h = hospital

        self.cfg = hl7_cfg

        self.rng = rng

        self.accents = bool(hl7_cfg.get("name_accents", True))

        self.version = str(hl7_cfg.get("version", "2.5"))

        self.processing_id = str(hl7_cfg.get("processing_id", "D"))

        self.terminator = hl7_cfg.get("segment_terminator", "\r")

        self.auth = hospital.sending_application  # assigning authority (HOS)

    # ------------------------------------------------------------------ data types

    def e(self, value: str | None) -> str:

        return escape(value, self.accents)

    def xcn(self, staff: Staff) -> str:

        fam, giv = self.e(staff.family), self.e(staff.given)

        reps = [f"{staff.hos_id}^{fam}^{giv}^^^^^^{self.auth}"]

        if staff.ordem:
            reps.append(f"{staff.ordem}^{fam}^{giv}^^^^^^N.Ordem")

        reps.append(
            f"{staff.mecanografico}^{fam}^{giv}^^^^^^{self.e('N.Mecanográfico')}"
        )

        return "~".join(reps)

    def location(self, bed: Bed) -> str:

        ward, room = bed.ward, bed.room

        return (
            f"{ward.code}^{room.number}^{bed.code}^{bed.uid}^^{bed.kind}^{ward.building}^{ward.floor}"
            f"^{self.e(room.label)}^^{self.auth}"
        )

    def origin(self, urgent: bool) -> str:

        src = self.h.emergency if urgent else self.h.outpatient

        return f"{src['code']}^^^^^{self.e(src['name'])}"

    # ------------------------------------------------------------------ segments

    def msh(self, trigger: str, when: datetime, control_id: str) -> str:

        return "|".join(
            [
                "MSH",
                "^~\\&",
                self.auth,
                self.h.facility,
                self.h.receiving_application,
                self.h.facility,
                ts(when),
                "",
                f"ADT^{trigger}^ADT_{trigger}",
                control_id,
                self.processing_id,
                self.version,
            ]
        )

    def evn(
        self,
        trigger: str,
        recorded: datetime,
        occurred: datetime,
        reason: str,
        operator: Staff,
    ) -> str:

        return "|".join(
            [
                "EVN",
                trigger,
                ts(recorded),
                "",
                reason,
                self.xcn(operator),
                ts(occurred),
                self.h.facility,
            ]
        )

    def pid(self, p: PatientIdentity) -> str:

        a = p.address

        fields = [""] * 22

        fields[0] = "PID"

        fields[1] = "1"

        fields[3] = f"{p.ns}^^^{self.auth}^NS~{p.sns}^^^HAS^SNS"

        fields[5] = (
            f"{self.e(p.family)}^{self.e(p.first_name)}^{self.e(p.middle_names)}^^^^L"
        )

        fields[7] = p.birth_date.strftime("%Y%m%d") + "000000"

        fields[8] = p.sex

        fields[11] = "^".join(
            [
                self.e(a.street),
                "",
                self.e(a.locality),
                self.e(a.district),
                a.postal_code,
                a.country,
                "N",
                self.e(a.concelho),
                a.dicofre,
            ]
        )

        phone = f"^PRN^PH^^^^^^^^^{p.phone}"

        if p.email:
            phone += f"~^NET^X.400^{self.e(p.email)}"

        fields[13] = phone

        fields[16] = self.e(p.marital_text)

        fields[18] = f"{p.processo}^^^{self.auth}"

        fields[21] = f"{p.nif}^^^AT^NIF"

        return "|".join(fields)

    def pv1(self, ev: AdtEvent) -> str:

        ep = ev.episode

        f = [""] * 52

        f[0] = "PV1"

        f[1] = "1"

        f[2] = "INT"

        f[3] = self.location(ev.bed)

        f[4] = "U" if ep.urgent else "C"

        if ev.trigger == "A02" and ev.prior_bed is not None:
            f[6] = self.location(ev.prior_bed)

        else:
            f[6] = self.origin(ep.urgent)

        f[7] = self.xcn(ev.attending)

        f[10] = ev.service.code

        f[14] = "1" if ep.urgent else "2"

        f[17] = self.xcn(ev.attending)

        f[19] = f"{ep.number}^^^{self.auth}"

        f[39] = self.h.servicing_facility

        f[41] = "A" if ev.trigger != "A03" else ""

        f[44] = ts(ep.admit_time) if ep.admit_time else ""

        if ev.trigger == "A03":
            f[36] = ep.disposition["code"] if ep.disposition else ""

            f[45] = ts(ev.occurred)

        f[51] = "V"

        return "|".join(f)

    def pv2(self, ev: AdtEvent) -> str | None:

        ep = ev.episode

        f = [""] * 13

        f[0] = "PV2"

        if ev.trigger == "A01":
            d = ep.diagnosis

            f[3] = f"{self.e(d.code)}^{self.e(d.text)}^{d.system}"

        elif ev.trigger == "A02":
            f[4] = f"{ev.reason[0]}^{self.e(ev.reason[1])}"

        else:
            f[12] = self.e(ep.condition)

        return "|".join(f)

    def dg1(
        self, set_id: int, code: str, text: str, system: str, when: datetime, dtype: str
    ) -> str:

        f = [""] * 18

        f[0] = "DG1"

        f[1] = str(set_id)

        f[3] = f"{self.e(code)}^{self.e(text)}^{system}^{self.auth}"

        f[5] = ts(when)

        f[6] = dtype

        f[15] = str(set_id)

        f[17] = "D"

        return "|".join(f)

    def in1(self, p: PatientIdentity) -> str:

        f = [""] * 50

        f[0] = "IN1"

        f[1] = "1"

        fe = self.h.financial_entity

        f[2] = f"{fe['code']}^{self.e(fe['name'])}"

        f[3] = f"{fe['code']}^{self.e(fe['name'])}^{self.auth}"

        f[49] = f"{p.sns}^^^{self.auth}"

        return "|".join(f)

    # ------------------------------------------------------------------ message

    def build(
        self, ev: AdtEvent, msh_time: datetime, recorded: datetime, operator: Staff
    ) -> RenderedMessage:

        ep = ev.episode

        control_id = str(uuid.uuid4())  # MSH-10: unique per message

        segments = [
            self.msh(ev.trigger, msh_time, control_id),
            self.evn(ev.trigger, recorded, ev.occurred, ev.reason[2], operator),
            self.pid(ep.patient),
            self.pv1(ev),
        ]

        pv2 = self.pv2(ev)

        if pv2:
            segments.append(pv2)

        if ev.trigger == "A03":
            segments.append(f"ROL|||DI|{self.xcn(ev.attending)}")

        if ev.trigger in ("A01", "A03"):
            d = ep.diagnosis

            dtype = "A" if ev.trigger == "A01" else "F"

            when = ep.admit_time or ev.occurred

            segments.append(self.dg1(1, d.code, d.text, d.system, when, dtype))

            if ev.trigger == "A03":
                for i, c in enumerate(
                    [c for c in ep.pool.comorbidities if c.code != d.code][:4], start=2
                ):
                    segments.append(self.dg1(i, c.code, c.text, c.system, when, "F"))

                for i, proc in enumerate(ep.procedures, start=1):
                    pdate = ts(
                        (ep.admit_time or ev.occurred)
                        + timedelta(hours=self.rng.randint(4, 30))
                    )

                    segments.append(
                        f"PR1|{i}||{self.e(proc['code'])}^{self.e(proc['text'])}^ICD10PCS^{self.auth}||{pdate}"
                    )

            segments.append(self.in1(ep.patient))

        return RenderedMessage(
            control_id=control_id,
            trigger=ev.trigger,
            msh_time=msh_time,
            recorded=recorded,
            occurred=ev.occurred,
            text=self.terminator.join(segments) + self.terminator,
            ns=ep.patient.ns,
            processo=ep.patient.processo,
            episode=ep.number or "",
            event=ev,
        )


def render_all(
    events: list[AdtEvent],
    builder: HL7Builder,
    operators: list[Staff],
    delay_range: tuple[int, int],
    max_delay_minutes: int,
    rng: random.Random,
) -> list[RenderedMessage]:
    """Assign registration times (EVN-2 / MSH-7) and render every event.



    Registration delays are capped below the bed-cleaning time so the message

    stream (ordered by MSH-7) never shows two patients in the same bed, and

    the messages of one episode always keep their clinical order.

    """

    lo, hi = delay_range

    hi = max(lo, min(hi, max_delay_minutes))

    last_per_episode: dict[int, datetime] = {}

    planned: list[tuple[datetime, datetime, AdtEvent]] = []

    for ev in sorted(events, key=lambda e: (e.occurred, 0 if e.census else 1)):
        recorded = ev.occurred + timedelta(
            minutes=rng.randint(lo, hi), seconds=rng.randint(0, 59)
        )

        msh_time = recorded + timedelta(seconds=rng.randint(1, 12))

        key = id(ev.episode)

        if key in last_per_episode and msh_time <= last_per_episode[key]:
            msh_time = last_per_episode[key] + timedelta(seconds=rng.randint(1, 5))

            recorded = min(recorded, msh_time - timedelta(seconds=1))

        last_per_episode[key] = msh_time

        planned.append((msh_time, recorded, ev))

    planned.sort(key=lambda item: item[0])

    return [
        builder.build(ev, msh, rec, rng.choice(operators)) for msh, rec, ev in planned
    ]
