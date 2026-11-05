# Patient Flow Intelligence

```
frontend/     React + Vite + TypeScript + Tailwind (porta 5173)
backend/      Spring Boot, Java 21, Maven (porta 8080)
algorithms/   FastAPI, Python (porta 8000, corre no compose)
keycloak/     realm "patientflow" e tema de login custom
postgres-init/ SQL de criação das bases de dados
docker-compose.yml  infraestrutura de desenvolvimento
compose.mvp.yml     demonstração separada do backend, sem frontend
```

## Como correr

Para iniciar o ambiente separado do backend e algoritmos, na pasta
`patient-flow-intelligence`, com Docker Compose v2:

```sh
docker compose --env-file .env.example -f compose.mvp.yml -p patientflow-mvp up -d --build --wait --wait-timeout 300
```

A API fica em http://localhost:18080/api e o Keycloak em http://localhost:19080.
Este ambiente tem volume próprio e não compila nem executa o frontend. Numa
base nova, o perfil `demo` cria 22 camas, 60 doentes, 52 episódios e oito pedidos
em espera. A localização mínima dos exemplos FHIR está desativada. A consulta
como administrador, a configuração manual dos grupos dos gestores e as
limitações dos scripts de validação estão em [DEMO.md](DEMO.md).

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
Keycloak e de um grupo organizacional compatível no claim `groups` do JWT.
A atribuição faz-se no Keycloak e exige renovar o token;
`/api/access/grants` mantém apenas registos legados, sem efeito na autorização.
Ver [SECURITY.md](backend/SECURITY.md).

Criar ULS, unidade ou serviço pela API exige credenciais de administração
Keycloak no backend. O Compose de desenvolvimento injeta-as a partir de `.env`;
ao executar no host, exportar `KEYCLOAK_ADMIN_USERNAME` e
`KEYCLOAK_ADMIN_PASSWORD` antes do arranque, conforme
[backend/README.md](backend/README.md#executar).

Para executar também o frontend e o backend em contentores, na pasta
`patient-flow-intelligence`:

```sh
docker compose up -d --build
```

Usar este modo ou o backend no host, pois ambos usam a porta 8080.

| Serviço | URL |
|---|---|
| Frontend (integração parcial) | http://localhost:5173 |
| Backend API | http://localhost:8080/api |
| Keycloak admin | http://localhost:9080 (admin/admin) |
| algorithms | http://localhost:8000/health |
| HAPI FHIR | http://localhost:8081 |
| RabbitMQ UI | http://localhost:15672 (pfi/pfi) |

Credenciais de desenvolvimento em `.env` (criado a partir de `.env.example`, não vai para o git).

O fluxo atual usa diretamente PostgreSQL, Keycloak e algorithms. RabbitMQ, Redis
e HAPI FHIR existem no Compose alargado, mas não constituem integrações ativas
do fluxo atual. A definição MinIO está comentada e a consola não é iniciada.
O backend expõe indicadores, decisões determinísticas `rules-v1` e eventos
WebSocket. O frontend já consulta hierarquia, camas, ocupantes e episódios;
o dashboard mantém dados fixos e ainda não consome as APIs analíticas nem os
eventos WebSocket. Modelos treinados são trabalho futuro.

A hierarquia atual é ULS → unidade → edifício → piso → serviço → ala →
enfermaria → quarto → cama. A migração V2 foi alterada; não está garantida a
atualização de bases que tenham aplicado a hierarquia anterior. A suite Java
e a validação Docker mantêm dependências do seed e dos grants antigos, com
bloqueios descritos no [README do backend](backend/README.md#testes).

Contratos: [API/FHIR](backend/README.md), [gestão operacional](backend/OPERATIONS.md),
[permissões/eventos](backend/SECURITY.md), [indicadores/algoritmos](backend/ANALYTICS.md).
Trabalho futuro sobre modelos inteligentes: [PLAN.md](backend/PLAN.md).
