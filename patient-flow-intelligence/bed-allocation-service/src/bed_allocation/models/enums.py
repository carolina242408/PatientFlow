from enum import StrEnum


class BedStatus(StrEnum):
    AVAILABLE = "AVAILABLE"
    OCCUPIED = "OCCUPIED"
    BLOCKED = "BLOCKED"
    CLEANING = "CLEANING"


class EncounterStatus(StrEnum):
    IN_PROGRESS = "IN_PROGRESS"
    FINISHED = "FINISHED"


class SuggestionStatus(StrEnum):
    PENDENTE = "PENDENTE"
    ACEITE = "ACEITE"
    REJEITADA = "REJEITADA"

