# Patient Flow Intelligence — backend

Spring Boot 4.1.1, Java 21, Maven, PostgreSQL e Flyway. A API valida tokens do
Keycloak, recebe Bundles FHIR de admissão/alta e mantém a ocupação e o histórico
das camas. Código, exemplos, migrações e testes estão integralmente neste módulo.

## Executar

Requisitos: JDK 21 ou superior, Docker e o Maven Wrapper incluído no módulo.
Na pasta `patient-flow-intelligence`, preparar `.env` a partir de `.env.example`
e iniciar a infraestrutura:

```bash
docker compose up -d postgresql keycloak
cd backend
./mvnw spring-boot:run
```

No PowerShell, usar `./mvnw.cmd` em vez de `./mvnw` e configurar `JAVA_HOME`
para a instalação do JDK. O servidor escuta em `http://localhost:8080`.

A especificação OpenAPI e a interface Swagger UI ficam disponíveis em
`http://localhost:8080/v3/api-docs` e
`http://localhost:8080/swagger-ui.html`. Para usar o Swagger:

```bash
docker compose up -d --build
```

Depois abrir `http://localhost:8080/swagger-ui.html`, clicar em **Authorize** e
introduzir um token JWT válido do Keycloak no esquema `bearerAuth`, no formato
`Bearer <token>`. O Swagger não cria um login próprio nem adiciona um cliente
ao realm; o token deve ser obtido através do cliente web da aplicação ou de
outro cliente autorizado do realm `patientflow`.

O perfil normal não insere dados de demonstração. Para experimentar os exemplos
numa base sem hierarquia hospitalar:

```bash
./mvnw spring-boot:run -Dspring-boot.run.profiles=demo
```

No PowerShell:

```powershell
./mvnw.cmd spring-boot:run '-Dspring-boot.run.profiles=demo'
```

O perfil `demo` cria a hierarquia mínima abaixo, apenas se não existir nenhuma
ULS, e acrescenta os cenários alargados de pressão/recuperação numa ULS própria:

```text
ULS Exemplo → Hospital Principal → Edifício A → Piso 3 → Ala Norte
  → Ward 30004 (Medicina Interna) → Room 7005 → Bed MAC / Bed MAD
```

Numa base nova são 24 camas, 60 doentes sintéticos, 52 episódios e oito pedidos
em espera. Os cenários são transacionais e repetíveis, sem repor alterações nem
atribuir acessos. Datas são relativas à primeira inserção. Para apenas a hierarquia
mínima, definir `PATIENTFLOW_DEMO_DATA=true` sem ativar o perfil `demo`.
Arranque Docker autónomo, perfis, credenciais e validação integrada estão em
[DEMO.md](../DEMO.md).

Sem esse perfil, criar primeiro a hierarquia através de `/api/hierarchy/{type}`;
a ingestão não cria unidades ou camas implicitamente. Os contratos de gestão,
altas e lista de espera estão em [OPERATIONS.md](OPERATIONS.md).

## Configuração

| Variável | Valor por omissão |
| --- | --- |
| `DB_URL` | `jdbc:postgresql://localhost:5432/patientflow` |
| `DB_USERNAME` | `pfi` |
| `DB_PASSWORD` | `pfi` |
| `KEYCLOAK_ISSUER_URI` | `http://localhost:9080/realms/patientflow` |
| `KEYCLOAK_JWK_SET_URI` (perfil `docker`) | Chaves do Keycloak na rede Docker; issuer externo continua validado |
| `FHIR_SNS_SYSTEM` | `https://www.sns.gov.pt/numero-utente` |
| `FHIR_HOSPITAL_NUMBER_SYSTEM` | `urn:hospital:process-number` |
| `FHIR_VISIT_NUMBER_SYSTEM` | `urn:hospital:visit-number` |
| `PATIENTFLOW_DEMO_DATA` | `false` |
| `WS_ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` |

O backend não carrega automaticamente o `.env` do Docker Compose. Para alterar
os valores acima, exportar as variáveis no processo que inicia o backend ou
usar configuração Spring. `ddl-auto=validate`: apenas o Flyway gere o esquema.
`V1__init.sql` e `V2__hospital_domain.sql` foram preservadas.
`V3__operational_management.sql` acrescenta a gestão operacional e associa as
enfermarias existentes a um serviço `GENERAL` da respetiva unidade, preservando
os internamentos. A migração exige no máximo um internamento ativo por doente;
dados antigos que violem essa regra devem ser reconciliados antes da atualização.
`V4__organizational_access.sql` cria as associações por `sub` Keycloak e a vista
de resolução de âmbitos. Não atribui acessos automaticamente aos utilizadores.
`V5__analytics_indexes.sql` acrescenta índices para consultas analíticas.

## Arquitetura e persistência

```text
com.projinf.patientflow
  domain/model   Entidades JPA e estados
  dto            Bundle normalizado e localização
  factory        FHIRParserFactory (Jackson 3, tools.jackson)
  repository     Interfaces de domínio, implementações e Spring Data JPA
  service        Orquestração da ingestão
  strategy       Estratégias in-progress e finished
  web            API FHIR, conta autenticada e ProblemDetail
  security       Resource server OAuth2/Keycloak e autorização organizacional
  event          Eventos após commit e WebSocket com bilhetes de uso único
  config         Dados sintéticos opcionais
```

Hierarquia: `ULS → HealthcareUnit → Building → Floor → Wing → Ward → Room → Bed`.
`Patient → Encounter → LocationAllocation → Bed` regista o internamento e as
suas alocações. Os identificadores internos são UUID; os códigos externos SNS
e de visita não dependem do `id` dos recursos FHIR.

O código da enfermaria é globalmente único nesta primeira versão. Quarto e cama
são únicos dentro do respetivo pai. SNS e número de visita são únicos.
Chaves estrangeiras, validações cronológicas e índices parciais PostgreSQL
impedem referências inválidas e mais de uma alocação aberta por cama ou episódio.
As alocações fechadas permanecem no histórico. Cama, doente e episódio têm
controlo de versão. Cada unidade tem serviços clínicos; cada enfermaria está
associada a um serviço da mesma unidade, distinto da sua posição física.

## API

| Método e caminho | Acesso | Resultado |
| --- | --- | --- |
| `GET /actuator/health` | Público | Estado do serviço |
| `GET /api/account` | Bearer token | Conta e authorities do token |
| `POST /api/fhir/bundles` | Bearer token | `204 No Content` |
| `/api/hierarchy/{type}` | Bearer token | Gestão da hierarquia e dos serviços clínicos |
| `/api/patients`, `/api/beds`, `/api/encounters`, `/api/allocations` | Bearer token | Consultas paginadas e operações documentadas |
| `GET /api/bed-map` | Bearer token | Camas, ocupantes, altas previstas e contagens por estado |
| `/api/admission-requests` | Bearer token | Fila de admissões, prioridades, admissão e cancelamento |
| `GET /api/access/me` | Bearer token | Papéis e associações efetivas do utilizador |
| `/api/access/grants` | Administrador | Consultar/criar/revogar associações organizacionais |
| `POST /api/events/tickets` | Administrador ou gestor com âmbito | Bilhete WebSocket de curta duração e uso único |
| `/ws/events?ticket=…` | Bilhete e origem autorizados | Eventos limitados ao âmbito atual |
| `GET /api/analytics/indicators` | Administrador ou gestor com âmbito | Ocupação, internamentos, altas e espera |
| `GET /api/analytics/alerts` | Administrador ou gestor com âmbito | Alertas com causas e limiares configuráveis |
| `GET /api/analytics/occupancy-forecast` | Administrador ou gestor com âmbito | Cenários determinísticos a 24/48 horas, por serviço |
| `GET /api/admission-requests/{id}/bed-suggestions` | Âmbito do pedido | Sugestões explicáveis de camas livres |

A ingestão aceita `application/json` e `application/fhir+json`. O administrador
tem acesso global; os gestores precisam do papel Keycloak e de uma associação
organizacional compatível, criada por um administrador. Consultas, contagens,
operações e eventos respeitam esse âmbito. A matriz de permissões, atribuição
inicial de acessos e protocolo de reconexão estão em [SECURITY.md](SECURITY.md).
Fórmulas, critérios, limites e configuração do passo 7 estão em [ANALYTICS.md](ANALYTICS.md).
A integração com o frontend fica planeada no passo 9; modelos treinados ficam
reservados ao futuro passo 10 do plano.

Os erros de validação e de domínio usam `application/problem+json`:

| Código | Situação |
| --- | --- |
| `400` | JSON malformado, campos inválidos/ausentes, estado não suportado ou dados contraditórios |
| `401` | Token ausente ou inválido |
| `403` | Papel/âmbito insuficiente ou operação reservada ao administrador |
| `404` | Recurso desconhecido ou fora do âmbito autorizado |
| `409` | Cama indisponível, reenvio contraditório, versão desatualizada, associação incompatível ou conflito de integridade |

### Contrato FHIR suportado

Cada pedido contém exatamente um `Patient` e um `Encounter`. Outros recursos
são ignorados, exceto os `Location` usados na localização. Bundles com vários
doentes/episódios são rejeitados para evitar associações implícitas.

| Dado | Resolução |
| --- | --- |
| SNS obrigatório | Sistema configurado, alias `urn:id:HAS`, tipo `SB` ou texto de tipo `SNS` |
| Processo hospitalar opcional | Sistema configurado, alias `urn:id:HOS`, tipo `MR` ou texto de tipo `NS` |
| Visita obrigatória | Sistema configurado, tipo `VN`, ou `Encounter.id` na ausência de identificador |
| Nome obrigatório | Primeiro nome `official`, ou primeiro nome disponível; `text` ou composição `given` + `family` |
| Nascimento opcional | Data completa `YYYY-MM-DD` |
| Género opcional | `male`, `female`, `other`, `unknown`; omissão usa `unknown` |
| Datas do episódio | `Encounter.period` ou `Encounter.actualPeriod`, ISO-8601 com fuso |
| Localização obrigatória | Três recursos `Location` com `physicalType.coding.code` `wa`, `ro`, `bd`, usando `identifier[0].value` ou `name`; ou um `Encounter.location.location.display` no formato `Ward …, Room …, Bed …` |

Os códigos de tipo de identificador são lidos do sistema
`http://terminology.hl7.org/CodeSystem/v2-0203`. Sistemas e tipos que apontem
para valores diferentes são rejeitados. Quando existe `Encounter.subject.reference`,
deve coincidir com `Patient/<id>` ou com o `fullUrl` da entrada Patient.
Se ambas as representações de período ou localização estiverem presentes,
devem concordar. Textos persistidos têm um limite de 255 caracteres.

O parser cobre os formatos documentados; não é um validador integral de todos
os recursos ou versões FHIR. Não resolve recursos remotos, referências de
localização sem os dados descritos acima, nem datas de nascimento parciais.

### Admissão e alta

- `in-progress`: encontra uma cama livre, cria/reutiliza o doente pelo SNS,
  cria o episódio, ocupa a cama e regista a alocação numa transação. O início
  vem do bundle, ou do instante de processamento se estiver omisso.
- `finished`: procura o episódio pelo número de visita, confirma doente,
  localização e datas, fecha a alocação e coloca a cama em `CLEANING`. O fim vem
  do bundle, ou do instante de processamento se estiver omisso. Só a conclusão
  da limpeza torna a cama novamente `AVAILABLE`.
- Reenvios equivalentes devolvem `204`, sem duplicar doente, episódio ou alocação.
  Uma admissão atrasada de um episódio já terminado é aceite sem o reabrir.
  Valores contraditórios de SNS, cama ou datas devolvem `409`.
- Uma alta recebida antes da admissão devolve `404` sem efeitos. Pode ser
  reenviada após a admissão; não existe uma fila implícita de mensagens FHIR.
- Datas omitidas em reenvios não substituem as já registadas. Datas explícitas
  devem coincidir, à precisão de microssegundos usada pelo PostgreSQL.
- Um doente existente é reutilizado sem substituir dados demográficos. As
  correções são feitas explicitamente por `PUT /api/patients/{id}`, com versão.
- Bloqueios transacionais por visita e SNS, bloqueios de linha da cama e índices
  únicos impedem dupla ocupação e mais de um internamento ativo por doente.

### Exemplos autónomos

Os quatro ficheiros em `examples/fhir` são também os fixtures dos testes:

| Ficheiros | Formato |
| --- | --- |
| `admission.json`, `discharge.json` | Identificadores hospitalares por sistema/tipo, `actualPeriod` e localização textual |
| `admission-locations.json`, `discharge-locations.json` | Sistemas configurados, `period` e recursos `Location` separados |

Com o perfil `demo` e um access token válido do realm `patientflow`:

```bash
export TOKEN='ACCESS_TOKEN'
curl -i http://localhost:8080/api/fhir/bundles \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/fhir+json' \
  --data-binary @examples/fhir/admission.json
curl -i http://localhost:8080/api/fhir/bundles \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/fhir+json' \
  --data-binary @examples/fhir/discharge.json
```

No PowerShell, usar `curl.exe`, `$env:TOKEN` e um comando por linha:

```powershell
curl.exe -i http://localhost:8080/api/fhir/bundles -H "Authorization: Bearer $env:TOKEN" -H 'Content-Type: application/fhir+json' --data-binary '@examples/fhir/admission.json'
curl.exe -i http://localhost:8080/api/fhir/bundles -H "Authorization: Bearer $env:TOKEN" -H 'Content-Type: application/fhir+json' --data-binary '@examples/fhir/discharge.json'
```

## Testes

```bash
./mvnw test
```

Requer Docker em execução. Testcontainers cria um PostgreSQL 16 temporário,
aplica as migrações reais, valida o mapeamento JPA e remove os contentores
de teste no fim. Não usa as bases de desenvolvimento nem necessita de Keycloak:
o decoder JWT é substituído apenas nos testes.

Cobertura: formatos FHIR, identificadores e referências, datas, entradas
ambíguas, ingestão autenticada, `/api/account`, health público, admissão/alta,
histórico, erros 400/404/409 e restrições de integridade PostgreSQL.
Inclui ainda gestão operacional, reenvios, corridas entre pedidos concorrentes,
rollback da admissão em fila e atualização de uma base V2 com dados existentes.
Os testes da etapa 6 usam gestores em ULS/unidades/serviços distintos e ligações
WebSocket reais: isolamento, reenvios, rollback, revogação, origem, uso único do
bilhete, expiração do JWT e recuperação por nova consulta após reconexão.
Inclui indicadores, regras/contrato Python, degradação e os cenários alargados:
estados, histórico sem sobreposição, repetibilidade e preservação de alterações.
A validação direta das APIs e WebSocket com Keycloak real, sem frontend ou Node,
é executada separadamente por
`python scripts/verify_mvp.py`, na raiz do projeto; instruções em [DEMO.md](../DEMO.md).
Para executar apenas o parser, sem Docker:

```bash
./mvnw -Dtest=FHIRParserFactoryTest test
```

O [plano restante](PLAN.md) descreve as etapas ainda por implementar.
