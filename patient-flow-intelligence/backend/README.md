# backend

Spring Boot (Java 21, Maven). Resource server OAuth2: valida tokens do Keycloak (realm `patientflow`). JPA + Flyway sobre o Postgres do `docker compose`.

```bash
export JAVA_HOME=$(/usr/libexec/java_home -v 21)   # ou 25
./mvnw spring-boot:run        # http://localhost:8080
./mvnw test
```

- `GET /api/account` — utilizador e roles do token (autenticado)
- `GET /actuator/health` — público
- Migrações em `src/main/resources/db/migration`
