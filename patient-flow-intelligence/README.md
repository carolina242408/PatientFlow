# Patient Flow Intelligence

```
frontend/     React + Vite + TypeScript + Tailwind (porta 5173)
backend/      Spring Boot, Java 21, Maven (porta 8080)
algorithms/   FastAPI, Python (porta 8000, corre no compose)
keycloak/     realm "patientflow" e tema de login custom
postgres-init/ SQL de criação das bases de dados
docker-compose.yml  infraestrutura de desenvolvimento
```

## Como correr

Pré-requisitos: Docker, Node 20+, JDK 21+ (`export JAVA_HOME=$(/usr/libexec/java_home -v 21)` no macOS).

```bash
docker compose up -d                 # Postgres, Keycloak, RabbitMQ, Redis, HAPI FHIR, MinIO, algorithms
cd backend && ./mvnw spring-boot:run # http://localhost:8080
cd frontend && npm install && npm run dev   # http://localhost:5173
```

Abre `http://localhost:5173` e entra com `admin/admin` (ROLE_ADMIN) ou `user/user` (ROLE_USER).

| Serviço | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8080/api |
| Keycloak admin | http://localhost:9080 (admin/admin) |
| algorithms | http://localhost:8000/health |
| HAPI FHIR | http://localhost:8081 |
| RabbitMQ UI | http://localhost:15672 (pfi/pfi) |
| MinIO console | http://localhost:9001 (pfi/pfi12345) |

Credenciais de desenvolvimento em `.env`.
