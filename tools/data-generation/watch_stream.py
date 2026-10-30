#!/usr/bin/env python3
"""Interactive terminal watcher and real-time visualizer for PatientFlow synthetic data.

Modes:
1. Standalone Simulation Mode (default):
   Generates synthetic patient flow events and streams them live to the terminal
   with a configurable delay between events.

   Example:
     python watch_stream.py --days 3 --delay-ms 250
     python watch_stream.py --days 2 --delay-ms 100 --raw
     python watch_stream.py --trigger A01

2. Server Connect Mode (--connect):
   Connects to the running FastAPI server's SSE endpoint (GET /api/hl7/live)
   and streams live events emitted by the server.

   Example:
     python watch_stream.py --connect --url http://localhost:8001
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

# Ensure pfgen is importable
BASE_DIR = Path(__file__).resolve().parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from pfgen.hl7 import HL7Builder, render_all
from pfgen.hospital import Hospital
from pfgen.identity import IdentityRegistry
from pfgen.simulation import Simulation, output_events
from pfgen.synthea import load_pool, run_synthea, synthetic_pool
from pfgen.terminal import (
    BOLD,
    CYAN,
    DIM,
    GREEN,
    MAGENTA,
    RED,
    RESET,
    WHITE,
    YELLOW,
    format_event_card,
    parse_hl7_summary,
    print_event,
)

DEFAULT_HOSPITAL_CONFIG = BASE_DIR / "config" / "hospital.yaml"
DEFAULT_SIMULATION_CONFIG = BASE_DIR / "config" / "simulation.yaml"
DEFAULT_CACHE_DIR = BASE_DIR / ".cache" / "synthea"


def load_yaml(path: Path) -> dict[str, Any]:
    import yaml

    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def print_banner(mode: str, details: str) -> None:
    print(f"\n{BOLD}{CYAN}{'=' * 78}{RESET}")
    print(f"{BOLD}{WHITE}🏥  PatientFlow - Visualizador de Fluxo Hospitalar em Tempo Real{RESET}")
    print(f"{CYAN}{'=' * 78}{RESET}")
    print(f" {BOLD}Modo:{RESET}    {mode}")
    print(f" {BOLD}Info:{RESET}    {details}")
    print(f" {DIM}Pressione Ctrl+C para interromper a visualização a qualquer momento.{RESET}")
    print(f"{CYAN}{'=' * 78}{RESET}\n")
    sys.stdout.flush()


def run_standalone_stream(
    days: int,
    warmup_days: int,
    delay_ms: int,
    seed: int,
    trigger_filter: str | None,
    use_cards: bool,
    use_synthea: bool,
) -> None:
    """Run simulation directly and stream each event live with delay."""
    hosp_cfg = load_yaml(DEFAULT_HOSPITAL_CONFIG)
    sim_cfg = load_yaml(DEFAULT_SIMULATION_CONFIG)

    sim_cfg["simulation"]["days"] = days
    sim_cfg["simulation"]["warmup_days"] = warmup_days
    sim_cfg["simulation"]["seed"] = seed

    rng = random.Random(seed)
    hospital = Hospital(hosp_cfg)

    print(f"{DIM}[1/3] A carregar hospital '{hospital.name}' ({len(hospital.wards)} enfermarias, {sum(w.capacity for w in hospital.wards)} camas)...{RESET}")

    registry = IdentityRegistry(rng)
    sim_start = datetime.fromisoformat(sim_cfg["simulation"]["start"])
    total_days = float(days) + float(warmup_days)

    expected_adm = 0.0
    for s in hospital.specialties:
        spec_cfg = sim_cfg["specialties"].get(s, sim_cfg["specialties"]["MED"])
        if "admissions_per_day" in spec_cfg:
            rate = float(spec_cfg["admissions_per_day"])
        else:
            cap = hospital.capacity_of(s)
            rate = cap * float(spec_cfg.get("target_occupancy", 0.85)) / float(spec_cfg["los"]["mean"])
        expected_adm += rate * total_days
    population_size = max(40, int(expected_adm * 1.3))

    if use_synthea:
        print(f"{DIM}[2/3] A obter doentes clínicos Synthea (população: {population_size})...{RESET}")
        try:
            fhir_dir = run_synthea(
                cache_dir=DEFAULT_CACHE_DIR,
                jar_url=sim_cfg["synthea"]["jar_url"],
                population=population_size,
                seed=seed,
                min_age=int(sim_cfg["synthea"].get("min_age", 18)),
                max_age=int(sim_cfg["synthea"].get("max_age", 95)),
                reference_date=sim_start.date(),
            )
            pool = load_pool(fhir_dir, hospital.specialties)
        except Exception as e:
            print(f"{YELLOW}Aviso: Synthea falhou ({e}), a usar perfis demográficos instantâneos...{RESET}")
            pool = synthetic_pool(population_size, rng, sim_start, 18, 95)
    else:
        print(f"{DIM}[2/3] A gerar base de doentes sintéticos instantânea (--no-synthea)...{RESET}")
        pool = synthetic_pool(population_size, rng, sim_start, 18, 95)

    print(f"{DIM}[3/3] A simular motor de internamento e transferências...{RESET}")
    sim = Simulation(hospital, sim_cfg, pool, registry, rng)
    res = sim.run()
    active_events = output_events(res, "census")

    builder = HL7Builder(hospital, sim_cfg["hl7"], rng)
    messages = render_all(
        events=active_events,
        builder=builder,
        operators=res.operators,
        delay_range=(0, 10),
        max_delay_minutes=30,
        rng=rng,
    )

    if trigger_filter:
        messages = [m for m in messages if m.trigger == trigger_filter]

    total = len(messages)
    details = f"{days} dias de simulação | {total} eventos | Intervalo: {delay_ms}ms"
    if trigger_filter:
        details += f" | Filtro: ADT^{trigger_filter}"
    print_banner("Simulação Direta em Tempo Real", details)

    stats = {"A01": 0, "A02": 0, "A03": 0}

    for idx, msg in enumerate(messages, 1):
        stats[msg.trigger] = stats.get(msg.trigger, 0) + 1

        if use_cards:
            summary = parse_hl7_summary(msg.text)
            print_event(summary, show_raw=False, index=idx, total=total)
        else:
            formatted_hl7 = msg.text.replace("\r\n", "\n").replace("\r", "\n").strip()
            print(f"{BOLD}{CYAN}=== [{idx}/{total}] ADT^{msg.trigger} | MSH-10: {msg.control_id} | Episódio: {msg.episode} ==={RESET}")
            print(formatted_hl7)
            print()
            sys.stdout.flush()

        if delay_ms > 0 and idx < total:
            time.sleep(delay_ms / 1000.0)

    # Final summary box
    print(f"\n{BOLD}{CYAN}{'=' * 78}{RESET}")
    print(f"{BOLD}{WHITE}📊  Resumo dos Eventos Emitidos em Tempo Real{RESET}")
    print(f"{CYAN}{'=' * 78}{RESET}")
    print(f"   🟢 {GREEN}Admissões (ADT^A01):{RESET}       {stats.get('A01', 0)}")
    print(f"   🟡 {YELLOW}Transferências (ADT^A02):{RESET}  {stats.get('A02', 0)}")
    print(f"   🔴 {RED}Altas (ADT^A03):{RESET}            {stats.get('A03', 0)}")
    print(f"   📋 {BOLD}Total de Mensagens HL7:{RESET}   {total}")
    print(f"{CYAN}{'=' * 78}{RESET}\n")


def run_sse_stream(
    server_url: str,
    trigger_filter: str | None,
    use_cards: bool,
    delay_ms: int,
) -> None:
    """Connect to FastAPI SSE endpoint and stream events live."""
    import urllib.request

    url = f"{server_url.rstrip('/')}/api/hl7/live?delay_ms={delay_ms}"
    if trigger_filter:
        url += f"&trigger={trigger_filter}"

    print_banner(
        "Ligação ao Servidor REST API (Server-Sent Events)",
        f"URL: {url} | Filtro: {trigger_filter or 'Todos'} | Delay: {delay_ms}ms",
    )

    print(f"{DIM}A estabelecer ligação contínua a {url}...{RESET}")
    req = urllib.request.Request(url, headers={"Accept": "text/event-stream"})

    try:
        count = 0
        stats = {"A01": 0, "A02": 0, "A03": 0}

        with urllib.request.urlopen(req) as response:
            print(f"{GREEN}Ligado com sucesso! A receber stream em direto:{RESET}\n")

            for raw_line in response:
                line = raw_line.decode("utf-8")
                if line.startswith("data: "):
                    json_str = line[6:].strip()
                    try:
                        data = json.loads(json_str)
                        hl7_text = data.get("hl7", "")
                        count += 1
                        trig = data.get("trigger", "ADT")
                        stats[trig] = stats.get(trig, 0) + 1

                        if use_cards:
                            summary = parse_hl7_summary(hl7_text) if hl7_text else data
                            print_event(summary, show_raw=False, index=count)
                        else:
                            formatted_hl7 = hl7_text.replace("\r\n", "\n").replace("\r", "\n").strip()
                            cid = data.get("control_id", "")
                            ep = data.get("episode", "")
                            print(f"{BOLD}{CYAN}=== [{count}] ADT^{trig} | MSH-10: {cid} | Episódio: {ep} ==={RESET}")
                            print(formatted_hl7)
                            print()
                            sys.stdout.flush()

                    except Exception as err:
                        print(f"{YELLOW}Aviso ao descodificar evento: {err}{RESET}")

    except KeyboardInterrupt:
        print(f"\n{YELLOW}Visualização interrompida pelo utilizador.{RESET}")
    except Exception as ex:
        print(f"\n{RED}Erro na ligação ao servidor SSE ({url}): {ex}{RESET}")
        print(f"{DIM}Certifique-se de que o servidor está a correr (python tools/data-generation/main.py --serve --port 8001){RESET}")


def check_server_running(url: str) -> bool:
    """Check if the REST API server is responsive."""
    import urllib.request

    try:
        health_url = f"{url.rstrip('/')}/health"
        with urllib.request.urlopen(health_url, timeout=1.0) as res:
            return res.status == 200
    except Exception:
        return False


def main() -> None:
    parser = argparse.ArgumentParser(
        description="PatientFlow: Terminal Live Watcher & Real-time Synthetic Data Streamer",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument("--connect", action="store_true", help="Connect to running FastAPI REST API server (SSE stream)")
    parser.add_argument("--url", type=str, default="http://localhost:8001", help="REST API server URL")
    parser.add_argument("--delay-ms", type=int, default=250, help="Delay between printed events in milliseconds")
    parser.add_argument("--trigger", choices=["A01", "A02", "A03"], help="Filter by HL7 trigger event")
    parser.add_argument("--cards", action="store_true", help="Display summary cards instead of raw HL7 messages")
    parser.add_argument("--days", type=int, default=3, help="Simulation days (standalone mode)")
    parser.add_argument("--warmup-days", type=int, default=1, help="Warmup days (standalone mode)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--synthea", action="store_true", help="Run full Synthea in standalone mode (slower)")

    args = parser.parse_args()

    # Determine mode:
    # If explicitly requested --connect, or if server is running on localhost:8001 and --days was not explicitly passed
    is_server_up = check_server_running(args.url)

    if args.connect or (is_server_up and "--days" not in sys.argv):
        print(f"{CYAN}Detetado servidor ativo em {args.url}. A iniciar modo SSE Live Stream...{RESET}")
        run_sse_stream(
            server_url=args.url,
            trigger_filter=args.trigger,
            use_cards=args.cards,
            delay_ms=args.delay_ms,
        )
    else:
        if args.connect and not is_server_up:
            print(f"{RED}Servidor em {args.url} não respondeu. A recorrer à simulação direta...{RESET}")
        run_standalone_stream(
            days=args.days,
            warmup_days=args.warmup_days,
            delay_ms=args.delay_ms,
            seed=args.seed,
            trigger_filter=args.trigger,
            use_cards=args.cards,
            use_synthea=args.synthea,
        )


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n{YELLOW}Terminado pelo utilizador.{RESET}")

