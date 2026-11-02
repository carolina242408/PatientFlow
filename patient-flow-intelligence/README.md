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

Para uma demonstração do backend e algoritmos apenas com Docker:

```sh
docker compose --env-file .env.example -f compose.mvp.yml -p patientflow-mvp up -d --build --wait --wait-timeout 300
```

A API fica em http://localhost:18080/api e o Keycloak em http://localhost:19080.
Perfis de gestores, obtenção de tokens, atribuição de âmbitos pela API, cenários
sintéticos e validação automática estão em [DEMO.md](DEMO.md). Este ambiente
tem volume próprio e não compila nem executa o frontend.

Para desenvolver o backend no host: Docker, JDK 21+ e `JAVA_HOME` configurado.

```bash
cp .env.example .env               # credenciais de desenvolvimento
docker compose up -d postgresql keycloak algorithms
cd backend
./mvnw spring-boot:run              # http://localhost:8080; perfil normal sem seed
```

No PowerShell usar `./mvnw.cmd`. O realm de desenvolvimento é importado de
`keycloak/realm`; gerir as contas/papéis no Keycloak. Um realm já existente
não é sobrescrito pela importação no arranque. Um gestor precisa do papel
Keycloak e de associação organizacional criada pelo administrador em
`/api/access/grants`; ver [SECURITY.md](backend/SECURITY.md).

| Serviço | URL |
|---|---|
| Frontend existente (opcional, integração pendente) | http://localhost:5173 |
| Backend API | http://localhost:8080/api |
| Keycloak admin | http://localhost:9080 (admin/admin) |
| algorithms | http://localhost:8000/health |
| HAPI FHIR | http://localhost:8081 |
| RabbitMQ UI | http://localhost:15672 (pfi/pfi) |
| MinIO console | http://localhost:9001 (pfi/pfi12345) |

Credenciais de desenvolvimento em `.env` (criado a partir de `.env.example`, não vai para o git).

O MVP usa diretamente PostgreSQL, Keycloak e algorithms. RabbitMQ, Redis,
HAPI FHIR e MinIO são opcionais; não constituem integrações ativas do fluxo atual.
O backend expõe indicadores, decisões determinísticas `rules-v1` e eventos
WebSocket. A integração com o frontend está planeada no passo 9; o frontend
atual mantém a implementação anterior e os seus dados de demonstração.
Modelos treinados estão reservados ao futuro passo 10.

Contratos: [API/FHIR](backend/README.md), [gestão operacional](backend/OPERATIONS.md),
[permissões/eventos](backend/SECURITY.md), [indicadores/algoritmos](backend/ANALYTICS.md).
Estado das etapas: [PLAN.md](backend/PLAN.md).
