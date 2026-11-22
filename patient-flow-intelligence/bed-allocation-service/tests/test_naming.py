from bed_allocation.models.allocation import AllocationSuggestionRecord
from bed_allocation.models.enums import SuggestionStatus


def test_allocation_suggestion_naming():
    assert AllocationSuggestionRecord.__tablename__ == "allocation_suggestions"
    assert {status.value for status in SuggestionStatus if status.name in {
        "PENDING", "ACCEPTED", "REJECTED"
    }} == {"PENDING", "ACCEPTED", "REJECTED"}
