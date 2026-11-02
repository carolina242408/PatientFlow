"""Portuguese patient identities with strict identifier integrity.

Guarantees enforced here (and re-checked by ``validate.py`` on the produced
HL7 text):

* PID-3  NS (``^^^HOS^NS``)  -> unique per patient, never reused.
* PID-3  SNS (``^^^HAS^SNS``) -> unique per patient.
* PID-18 Nº de processo       -> unique per patient, stable across episodes.
* PID-21 NIF                  -> unique, valid mod-11 check digit.
* PID-5  name                 -> frozen together with the identifiers, so the
  same NS always travels with exactly the same name, birth date and sex.

Homonyms (different patients, same name) are injected on purpose at a
configurable rate; they always receive *different* identifiers.

Identifiers already handed out can be persisted in a registry file so that
several generator runs loaded into the same application never assign the same
NS / processo / SNS / NIF / episode number to two different people.
"""

from __future__ import annotations

import json
import random
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

from . import pt_data


@dataclass(frozen=True)
class Address:
    street: str
    locality: str
    concelho: str
    district: str
    postal_code: str
    dicofre: str
    country: str = "PRT"


@dataclass(frozen=True)
class PatientIdentity:
    key: str                      # internal key (Synthea patient UUID)
    ns: str                       # PID-3 HOS^NS  (Nº sequencial)
    sns: str                      # PID-3 HAS^SNS (Nº utente SNS)
    nif: str                      # PID-21 AT^NIF
    processo: str                 # PID-18.1 (Nº de processo clínico)
    given: tuple[str, ...]
    surnames: tuple[str, ...]
    sex: str                      # "M" | "F"
    birth_date: date
    marital_code: str             # S/M/D/W/L
    address: Address
    phone: str
    email: str | None
    homonym_of: str | None = None  # NS of the patient whose name was copied

    @property
    def family(self) -> str:
        return " ".join(self.surnames)

    @property
    def first_name(self) -> str:
        return self.given[0]

    @property
    def middle_names(self) -> str:
        return " ".join(self.given[1:])

    @property
    def full_name(self) -> str:
        return " ".join([*self.given, *self.surnames])

    @property
    def marital_text(self) -> str:
        return pt_data.MARITAL[self.marital_code][self.sex]

    def age_on(self, day: date) -> int:
        years = day.year - self.birth_date.year
        if (day.month, day.day) < (self.birth_date.month, self.birth_date.day):
            years -= 1
        return years


@dataclass(frozen=True)
class Staff:
    """Doctor or administrative operator (HL7 XCN with several id systems)."""

    hos_id: str
    mecanografico: str
    given: str
    family: str
    ordem: str | None = None      # Nº da Ordem dos Médicos (doctors only)
    ward_code: str | None = None

    @property
    def display(self) -> str:
        return f"{self.given} {self.family}"


def ascii_fold(text: str) -> str:
    return unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")


def nif_check_digit(first8: str) -> str:
    total = sum(int(d) * (9 - i) for i, d in enumerate(first8))
    check = 11 - (total % 11)
    return "0" if check >= 10 else str(check)


def is_valid_nif(nif: str) -> bool:
    return len(nif) == 9 and nif.isdigit() and nif_check_digit(nif[:8]) == nif[8]


@dataclass
class IdentityRegistry:
    """Allocates identifiers and guarantees they are never shared."""

    rng: random.Random
    ns_start: int = 1_200_000
    processo_start: int = 15_000_000
    homonym_rate: float = 0.03
    homonym_same_birthdate_rate: float = 0.2
    email_rate: float = 0.4
    used_ns: set[str] = field(default_factory=set)
    used_sns: set[str] = field(default_factory=set)
    used_nif: set[str] = field(default_factory=set)
    used_processo: set[str] = field(default_factory=set)
    used_staff_ids: set[str] = field(default_factory=set)
    episode_seq: dict[str, int] = field(default_factory=dict)
    identities: dict[str, PatientIdentity] = field(default_factory=dict)   # key -> identity
    by_ns: dict[str, PatientIdentity] = field(default_factory=dict)
    _next_ns: int = 0
    _next_processo: int = 0

    def __post_init__(self) -> None:
        self._next_ns = max([self.ns_start, *[int(v) + 1 for v in self.used_ns]])
        self._next_processo = max([self.processo_start, *[int(v) + 1 for v in self.used_processo]])

    # ------------------------------------------------------------------ persistence
    @classmethod
    def load(cls, path: Path | None, rng: random.Random, **kwargs) -> "IdentityRegistry":
        state: dict = {}
        if path and path.exists():
            state = json.loads(path.read_text(encoding="utf-8"))
        return cls(
            rng=rng,
            used_ns=set(state.get("ns", [])),
            used_sns=set(state.get("sns", [])),
            used_nif=set(state.get("nif", [])),
            used_processo=set(state.get("processo", [])),
            used_staff_ids=set(state.get("staff", [])),
            episode_seq=dict(state.get("episode_seq", {})),
            **kwargs,
        )

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        state = {
            "ns": sorted(self.used_ns),
            "sns": sorted(self.used_sns),
            "nif": sorted(self.used_nif),
            "processo": sorted(self.used_processo),
            "staff": sorted(self.used_staff_ids),
            "episode_seq": self.episode_seq,
        }
        path.write_text(json.dumps(state, indent=1), encoding="utf-8")

    # ------------------------------------------------------------------ allocators
    def _alloc_ns(self) -> str:
        # Sequential with small gaps, like a real patient master index.
        self._next_ns += self.rng.randint(1, 3)
        value = str(self._next_ns)
        while value in self.used_ns:
            self._next_ns += 1
            value = str(self._next_ns)
        self.used_ns.add(value)
        return value

    def _alloc_processo(self) -> str:
        self._next_processo += self.rng.randint(1, 4)
        value = f"{self._next_processo:08d}"
        while value in self.used_processo:
            self._next_processo += 1
            value = f"{self._next_processo:08d}"
        self.used_processo.add(value)
        return value

    def _alloc_unique(self, used: set[str], factory) -> str:
        for _ in range(10_000):
            value = factory()
            if value not in used:
                used.add(value)
                return value
        raise RuntimeError("Identifier space exhausted")

    def _alloc_sns(self) -> str:
        return self._alloc_unique(self.used_sns, lambda: str(self.rng.randint(100_000_000, 399_999_999)))

    def _alloc_nif(self) -> str:
        def make() -> str:
            first8 = str(self.rng.choice("123")) + "".join(str(self.rng.randint(0, 9)) for _ in range(7))
            return first8 + nif_check_digit(first8)
        return self._alloc_unique(self.used_nif, make)

    def next_episode(self, year: int) -> str:
        """Episode number (PV1-19): YY + 6-digit yearly sequence, e.g. 26000123."""
        yy = f"{year % 100:02d}"
        self.episode_seq[yy] = self.episode_seq.get(yy, 0) + 1
        return f"{yy}{self.episode_seq[yy]:06d}"

    # ------------------------------------------------------------------ names
    def _given_names(self, sex: str) -> tuple[str, ...]:
        pool = pt_data.MALE_GIVEN if sex == "M" else pt_data.FEMALE_GIVEN
        first = self.rng.choice(pool)
        if self.rng.random() < 0.6:
            second = self.rng.choice([n for n in pool if n != first])
            return (first, second)
        return (first,)

    def _surname(self) -> str:
        weights = [1 / (i + 4) for i in range(len(pt_data.SURNAMES))]
        name = self.rng.choices(pt_data.SURNAMES, weights=weights)[0]
        if self.rng.random() < 0.12:
            name = f"{self.rng.choice(pt_data.SURNAME_PARTICLES)} {name}"
        return name

    def _surnames(self) -> tuple[str, ...]:
        count = self.rng.choices([1, 2, 3], weights=[0.1, 0.7, 0.2])[0]
        names: list[str] = []
        while len(names) < count:
            candidate = self._surname()
            if candidate not in names:
                names.append(candidate)
        return tuple(names)

    def _address(self) -> Address:
        conc = self.rng.choices(pt_data.CONCELHOS, weights=[c["weight"] for c in pt_data.CONCELHOS])[0]
        street = f"{self.rng.choice(pt_data.STREET_TYPES)} {self.rng.choice(pt_data.STREET_NAMES)}"
        number = self.rng.randint(1, 450)
        suffix = self.rng.choice(pt_data.FLOOR_SUFFIXES)
        street_line = f"{street}, {number}" + (f" {suffix}" if suffix else "")
        cp4 = self.rng.randint(*conc["cp"])
        return Address(
            street=street_line,
            locality=self.rng.choice(conc["localities"]),
            concelho=conc["name"],
            district=conc["district"],
            postal_code=f"{cp4}-{self.rng.randint(1, 999):03d}",
            dicofre=f"{conc['dicofre']}{self.rng.randint(1, 60):02d}",
        )

    def _marital(self, sex: str, age: int) -> str:
        if age < 25:
            return "S"
        if age >= 75:
            weights = {"M": 0.45, "W": 0.4 if sex == "F" else 0.2, "S": 0.08, "D": 0.05, "L": 0.02}
        else:
            weights = {"M": 0.55, "S": 0.25, "D": 0.13, "W": 0.04, "L": 0.03}
        codes, w = zip(*weights.items())
        return self.rng.choices(codes, weights=w)[0]

    def _phone(self) -> str:
        if self.rng.random() < 0.85:
            return self.rng.choice(["91", "92", "93", "96"]) + "".join(str(self.rng.randint(0, 9)) for _ in range(7))
        return "253" + "".join(str(self.rng.randint(0, 9)) for _ in range(6))

    def _email(self, given: tuple[str, ...], surnames: tuple[str, ...], age: int) -> str | None:
        if age > 80 or self.rng.random() > self.email_rate:
            return None
        local = ascii_fold(f"{given[0]}.{surnames[-1].split()[-1]}").lower()
        if self.rng.random() < 0.6:
            local += str(self.rng.randint(1, 99))
        return f"{local}@{self.rng.choice(pt_data.EMAIL_DOMAINS)}"

    # ------------------------------------------------------------------ public API
    def get(self, key: str) -> PatientIdentity | None:
        return self.identities.get(key)

    def create(self, key: str, sex: str, birth_date: date, reference_day: date) -> PatientIdentity:
        """Create (once) the identity for a Synthea patient.

        Calling this twice for the same key returns the same identity, which
        is what keeps PID-3 / PID-5 / PID-18 stable on readmissions.
        """
        if key in self.identities:
            return self.identities[key]

        homonym_of: str | None = None
        given = self._given_names(sex)
        surnames = self._surnames()
        age = max(0, reference_day.year - birth_date.year)

        if self.identities and self.rng.random() < self.homonym_rate:
            same_sex = [p for p in self.identities.values() if p.sex == sex and p.homonym_of is None]
            if same_sex:
                source = self.rng.choice(same_sex)
                given, surnames, homonym_of = source.given, source.surnames, source.ns
                if self.rng.random() < self.homonym_same_birthdate_rate and abs(
                    source.birth_date.year - birth_date.year
                ) <= 5:
                    # Hardest case for patient matching: same name AND birth date.
                    birth_date = source.birth_date

        identity = PatientIdentity(
            key=key,
            ns=self._alloc_ns(),
            sns=self._alloc_sns(),
            nif=self._alloc_nif(),
            processo=self._alloc_processo(),
            given=given,
            surnames=surnames,
            sex=sex,
            birth_date=birth_date,
            marital_code=self._marital(sex, age),
            address=self._address(),
            phone=self._phone(),
            email=self._email(given, surnames, age),
            homonym_of=homonym_of,
        )
        self.identities[key] = identity
        self.by_ns[identity.ns] = identity
        return identity

    def create_staff(self, ward_code: str | None, doctor: bool) -> Staff:
        sex = self.rng.choice("MF")
        given = self.rng.choice(pt_data.MALE_GIVEN if sex == "M" else pt_data.FEMALE_GIVEN)

        def staff_id(low: int, high: int) -> str:
            return self._alloc_unique(self.used_staff_ids, lambda: str(self.rng.randint(low, high)))

        return Staff(
            hos_id=staff_id(100, 9999),
            mecanografico=staff_id(10000, 29999),
            given=given,
            family=self._surname(),
            ordem=str(self.rng.randint(20000, 69999)) if doctor else None,
            ward_code=ward_code,
        )
