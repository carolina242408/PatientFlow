## [unreleased]

### Changed

- bed-allocation-service: renamed table `sugestoes_alocacao` to
  `allocation_suggestions`, status values to `PENDING`/`ACCEPTED`/`REJECTED`,
  and Python class `SugestaoAlocacao` to `AllocationSuggestionRecord`.
- Public HTTP routes remain unchanged pending a follow-up migration.
