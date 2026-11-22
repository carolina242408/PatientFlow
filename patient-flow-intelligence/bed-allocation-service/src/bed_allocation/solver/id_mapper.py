from uuid import UUID


class IdMapper:
    def __init__(self) -> None:
        self._values: dict[UUID, int] = {}

    def to_int(self, value: UUID) -> int:
        if value not in self._values:
            self._values[value] = len(self._values)
        return self._values[value]

