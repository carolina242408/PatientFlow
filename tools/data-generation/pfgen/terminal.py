"""Terminal formatting and live event visualization for PatientFlow."""

from __future__ import annotations

import os
import re
import sys
from datetime import datetime
from typing import Any

# Enable ANSI escape sequences on Windows consoles if needed
if os.name == "nt":
    os.system("")

# Ensure stdout and stderr support UTF-8 on Windows
try:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

# ANSI color codes
RESET = "\033[0m"
BOLD = "\033[1m"
DIM = "\033[2m"
ITALIC = "\033[3m"

RED = "\033[91m"
GREEN = "\033[92m"
YELLOW = "\033[93m"
BLUE = "\033[94m"
MAGENTA = "\033[95m"
CYAN = "\033[96m"
WHITE = "\033[97m"

BG_GREEN = "\033[42m\033[30m"
BG_YELLOW = "\033[43m\033[30m"
BG_RED = "\033[41m\033[97m"
BG_BLUE = "\033[44m\033[97m"


DISPOSITION_MAP = {
    "01": "Domicílio com apoio domiciliário",
    "02": "Lar / Residência Sénior",
    "03": "Transferência para outro hospital",
    "04": "RNCCI (Cuidados Continuados)",
    "07": "Domicílio",
    "20": "Óbito / Falecido",
}


def format_hl7_location(loc_str: str) -> str:
    """Format an HL7 location component into a clean descriptive string."""
    if not loc_str:
        return ""
    parts = loc_str.split("^")
    ward = parts[0] if len(parts) > 0 else ""
    room = parts[1] if len(parts) > 1 else ""
    bed = parts[2] if len(parts) > 2 else ""
    kind = unescape_hl7(parts[5]) if len(parts) > 5 and parts[5] else ""
    floor = parts[7] if len(parts) > 7 else ""
    label = unescape_hl7(parts[8]) if len(parts) > 8 else ""

    # Origin format: 10015^^^^^URGENCIA
    if kind and not room and not bed:
        return f"{kind} ({ward})" if ward else kind

    desc = f"Serviço {ward}" if ward else ""
    if floor:
        desc += f" (Piso {floor})"
    if room:
        desc += f" -> Quarto {room}"
    if label:
        desc += f" [{label}]"
    if bed:
        desc += f" -> {kind or 'Cama'} {bed}"
    return desc or unescape_hl7(loc_str)


def unescape_hl7(text: str) -> str:
    """Decode HL7 \\XHH\\ hex escapes and delimiter escapes."""
    if not text:
        return ""

    def replace_hex(match: re.Match) -> str:
        try:
            return bytes.fromhex(match.group(1)).decode("latin-1")
        except Exception:
            return match.group(0)

    text = re.sub(r"\\X([0-9A-Fa-f]{2})\\", replace_hex, text)
    text = (
        text.replace("\\S\\ ", "^")
        .replace("\\S\\", "^")
        .replace("\\F\\", "|")
        .replace("\\R\\", "~")
        .replace("\\T\\", "&")
        .replace("\\E\\", "\\")
    )
    return text


def parse_hl7_summary(raw_hl7: str) -> dict[str, Any]:
    """Extract structured, human-readable information from an HL7 ADT message."""
    segments: dict[str, list[list[str]]] = {}
    for line in raw_hl7.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split("|")
        seg_id = parts[0]
        segments.setdefault(seg_id, []).append(parts)

    data: dict[str, Any] = {
        "trigger": "ADT",
        "control_id": "",
        "msh_time": "",
        "occurred": "",
        "name": "",
        "gender": "",
        "birthdate": "",
        "age": None,
        "ns": "",
        "sns": "",
        "nif": "",
        "processo": "",
        "episode": "",
        "ward": "",
        "room": "",
        "bed": "",
        "location_desc": "",
        "prior_location_desc": "",
        "service": "",
        "diagnosis": "",
        "reason": "",
        "condition": "",
        "disposition": "",
        "raw": raw_hl7,
    }

    # MSH
    if "MSH" in segments:
        msh = segments["MSH"][0]
        if len(msh) > 8:
            msg_type = msh[8].split("^")
            data["trigger"] = msg_type[1] if len(msg_type) > 1 else msg_type[0]
        if len(msh) > 9:
            data["control_id"] = msh[9]
        if len(msh) > 6:
            data["msh_time"] = msh[6]

    # EVN
    if "EVN" in segments:
        evn = segments["EVN"][0]
        if len(evn) > 6 and evn[6]:
            data["occurred"] = evn[6]
        elif len(evn) > 2 and evn[2]:
            data["occurred"] = evn[2]

    # PID
    if "PID" in segments:
        pid = segments["PID"][0]
        # PID-3
        if len(pid) > 3:
            for id_comp in pid[3].split("~"):
                parts = id_comp.split("^")
                val = parts[0]
                typ = parts[3] if len(parts) > 3 else (parts[4] if len(parts) > 4 else "")
                if "NS" in typ or typ == "HOS":
                    data["ns"] = val
                elif "SNS" in typ or "HAS" in typ:
                    data["sns"] = val
                elif not data["ns"]:
                    data["ns"] = val

        # PID-5: SURNAMES^GIVEN^MIDDLE^^^^L
        if len(pid) > 5 and pid[5]:
            name_parts = pid[5].split("^")
            surnames = unescape_hl7(name_parts[0])
            given = unescape_hl7(name_parts[1]) if len(name_parts) > 1 else ""
            middle = unescape_hl7(name_parts[2]) if len(name_parts) > 2 else ""
            full = f"{given} {middle} {surnames}".strip()
            data["name"] = " ".join(full.split())

        # PID-7: Birthdate
        if len(pid) > 7 and pid[7]:
            raw_b = pid[7][:8]
            try:
                b_dt = datetime.strptime(raw_b, "%Y%m%d")
                data["birthdate"] = b_dt.strftime("%d/%m/%Y")
                ref_dt = datetime.now()
                data["age"] = ref_dt.year - b_dt.year - ((ref_dt.month, ref_dt.day) < (b_dt.month, b_dt.day))
            except Exception:
                data["birthdate"] = raw_b

        # PID-8: Gender
        if len(pid) > 8:
            data["gender"] = pid[8]

        # PID-18.1: Processo
        if len(pid) > 18 and pid[18]:
            data["processo"] = pid[18].split("^")[0]

        # PID-21: NIF
        if len(pid) > 21 and pid[21]:
            data["nif"] = pid[21].split("^")[0]

    # PV1
    if "PV1" in segments:
        pv1 = segments["PV1"][0]
        # PV1-3: Assigned Location
        if len(pv1) > 3 and pv1[3]:
            data["location_desc"] = format_hl7_location(pv1[3])
            loc_parts = pv1[3].split("^")
            data["ward"] = loc_parts[0] if len(loc_parts) > 0 else ""
            data["room"] = loc_parts[1] if len(loc_parts) > 1 else ""
            data["bed"] = loc_parts[2] if len(loc_parts) > 2 else ""

        # PV1-6: Prior Location
        if len(pv1) > 6 and pv1[6]:
            data["prior_location_desc"] = format_hl7_location(pv1[6])

        # PV1-10: Hospital Service
        if len(pv1) > 10 and pv1[10]:
            data["service"] = pv1[10]

        # PV1-19: Episode
        if len(pv1) > 19 and pv1[19]:
            data["episode"] = pv1[19].split("^")[0]

        # PV1-36: Discharge Disposition
        if len(pv1) > 36 and pv1[36]:
            code = pv1[36].strip()
            data["disposition"] = DISPOSITION_MAP.get(code, code)

        # PV1-44 / PV1-45: Length of stay calculation
        if len(pv1) > 45 and pv1[44] and pv1[45]:
            try:
                t_adm = datetime.strptime(pv1[44][:14], "%Y%m%d%H%M%S")
                t_dis = datetime.strptime(pv1[45][:14], "%Y%m%d%H%M%S")
                delta = t_dis - t_adm
                d = delta.days
                h = delta.seconds // 3600
                data["los"] = f"{d} dias e {h} horas" if d > 0 else f"{h} horas"
            except Exception:
                pass

    # PV2
    if "PV2" in segments:
        pv2 = segments["PV2"][0]
        # PV2-3: Admit reason / Diagnosis
        if len(pv2) > 3 and pv2[3]:
            diag_parts = pv2[3].split("^")
            data["diagnosis"] = f"{diag_parts[0]} - {unescape_hl7(diag_parts[1])}" if len(diag_parts) > 1 else diag_parts[0]
        # PV2-4: Transfer reason
        if len(pv2) > 4 and pv2[4]:
            r_parts = pv2[4].split("^")
            data["reason"] = f"{r_parts[0]} - {unescape_hl7(r_parts[1])}" if len(r_parts) > 1 else r_parts[0]
        # PV2-12: Condition
        if len(pv2) > 12 and pv2[12]:
            data["condition"] = unescape_hl7(pv2[12])

    # DG1 (Alternative / Enriched diagnosis)
    if "DG1" in segments and not data["diagnosis"]:
        dg1 = segments["DG1"][0]
        if len(dg1) > 3 and dg1[3]:
            d_parts = dg1[3].split("^")
            data["diagnosis"] = f"{d_parts[0]} - {unescape_hl7(d_parts[1])}" if len(d_parts) > 1 else d_parts[0]

    return data


def format_timestamp(raw_ts: str) -> str:
    """Format YYYYMMDDHHMMSS into YYYY-MM-DD HH:MM:SS."""
    if not raw_ts:
        return ""
    cleaned = re.sub(r"[^\d]", "", raw_ts)[:14]
    try:
        if len(cleaned) == 14:
            dt = datetime.strptime(cleaned, "%Y%m%d%H%M%S")
            return dt.strftime("%Y-%m-%d %H:%M:%S")
        elif len(cleaned) == 8:
            dt = datetime.strptime(cleaned, "%Y%m%d")
            return dt.strftime("%Y-%m-%d")
    except Exception:
        pass
    return raw_ts


def format_event_card(
    data: dict[str, Any],
    show_raw: bool = False,
    index: int | None = None,
    total: int | None = None,
    color: bool = True,
) -> str:
    """Format an event dictionary into a clean terminal card."""
    trig = data.get("trigger", "ADT").upper()
    ts_str = format_timestamp(data.get("occurred") or data.get("msh_time", ""))

    c_green = GREEN if color else ""
    c_yellow = YELLOW if color else ""
    c_red = RED if color else ""
    c_cyan = CYAN if color else ""
    c_blue = BLUE if color else ""
    c_bold = BOLD if color else ""
    c_dim = DIM if color else ""
    c_white = WHITE if color else ""
    c_reset = RESET if color else ""

    bg_a01 = BG_GREEN if color else ""
    bg_a02 = BG_YELLOW if color else ""
    bg_a03 = BG_RED if color else ""

    idx_str = f" [{index}/{total}]" if index and total else (f" [#{index}]" if index else "")

    lines: list[str] = []
    width = 78

    if trig == "A01":
        header_badge = f"{bg_a01} ADT^A01 ADMISSÃO {c_reset}"
        title = f"{c_bold}{c_green}🟢 {header_badge}{c_white}{idx_str}  |  {ts_str}  |  Episódio: {data.get('episode')}{c_reset}"
    elif trig == "A02":
        header_badge = f"{bg_a02} ADT^A02 TRANSFERÊNCIA {c_reset}"
        title = f"{c_bold}{c_yellow}🟡 {header_badge}{c_white}{idx_str}  |  {ts_str}  |  Episódio: {data.get('episode')}{c_reset}"
    elif trig == "A03":
        header_badge = f"{bg_a03} ADT^A03 ALTA HOSPITALAR {c_reset}"
        title = f"{c_bold}{c_red}🔴 {header_badge}{c_white}{idx_str}  |  {ts_str}  |  Episódio: {data.get('episode')}{c_reset}"
    else:
        title = f"{c_bold}🔷 ADT^{trig}{idx_str}  |  {ts_str}  |  Episódio: {data.get('episode')}{c_reset}"

    lines.append(f"{c_cyan}{'═' * width}{c_reset}")
    lines.append(title)
    lines.append(f"{c_dim}{'─' * width}{c_reset}")

    # Patient info
    gender_txt = "Feminino" if data.get("gender") == "F" else ("Masculino" if data.get("gender") == "M" else data.get("gender", ""))
    age_str = f" ({data['age']} anos, {gender_txt})" if data.get("age") is not None else (f" ({gender_txt})" if gender_txt else "")
    lines.append(f"   {c_bold}👤 Doente:{c_reset}      {c_bold}{data.get('name') or 'N/D'}{c_reset}{age_str}")

    # Identifiers
    id_line = (
        f"   {c_dim}🆔 Ident.:{c_reset}      "
        f"NS: {c_cyan}{data.get('ns')}{c_reset}  |  "
        f"SNS: {c_cyan}{data.get('sns')}{c_reset}  |  "
        f"NIF: {c_cyan}{data.get('nif')}{c_reset}  |  "
        f"Processo: {c_cyan}{data.get('processo')}{c_reset}"
    )
    lines.append(id_line)

    # Event specific details
    if trig == "A01":
        lines.append(f"   {c_green}🏥 Atribuição:{c_reset}  {data.get('location_desc')}")
        if data.get("prior_location_desc"):
            lines.append(f"   {c_dim}🚪 Proveniência:{c_reset} {data.get('prior_location_desc')}")
        if data.get("diagnosis"):
            lines.append(f"   {c_bold}🩺 Diagnóstico:{c_reset}  {c_white}{data.get('diagnosis')}{c_reset}")

    elif trig == "A02":
        if data.get("prior_location_desc"):
            lines.append(f"   {c_yellow}🔄 De:{c_reset}          {data.get('prior_location_desc')}")
        lines.append(f"   {c_green}   Para:{c_reset}        {data.get('location_desc')}")
        if data.get("reason"):
            lines.append(f"   {c_dim}📋 Motivo:{c_reset}       {data.get('reason')}")

    elif trig == "A03":
        cond = data.get("condition") or "N/D"
        disp = data.get("disposition") or "Domicílio"
        lines.append(f"   {c_red}🏁 Desfecho:{c_reset}     Estado: {c_bold}{cond}{c_reset}  ->  Destino: {disp}")
        if data.get("los"):
            lines.append(f"   {c_dim}⏱️ Duração:{c_reset}      {data['los']}")
        lines.append(f"   {c_dim}🧹 Cama:{c_reset}         Libertada para higienização ({data.get('location_desc')})")
        if data.get("diagnosis"):
            lines.append(f"   {c_dim}🩺 Diagnóstico:{c_reset}  {data.get('diagnosis')}")

    # Message control ID
    lines.append(f"   {c_dim}🔑 MSH-10:{c_reset}      {data.get('control_id')}")

    # Raw HL7 view
    if show_raw and data.get("raw"):
        lines.append(f"{c_dim}{'─' * width}{c_reset}")
        lines.append(f"   {c_bold}📄 Mensagem HL7 v2.5 Crua:{c_reset}")
        for r_line in data["raw"].replace("\r\n", "\n").replace("\r", "\n").split("\n"):
            r_line = r_line.strip()
            if r_line:
                lines.append(f"   {c_dim}{r_line}{c_reset}")

    lines.append(f"{c_cyan}{'═' * width}{c_reset}")
    return "\n".join(lines)


def print_event(
    event_data: dict[str, Any],
    show_raw: bool = False,
    index: int | None = None,
    total: int | None = None,
) -> None:
    """Print an event card directly to stdout."""
    print(format_event_card(event_data, show_raw=show_raw, index=index, total=total))
    sys.stdout.flush()
