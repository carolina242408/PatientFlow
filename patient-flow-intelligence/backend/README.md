# Patient Flow Intelligence — backend

Spring Boot 4.1.1, Java 21, Maven, PostgreSQL e Flyway. A API valida tokens do
Keycloak, recebe Bundles FHIR de admissão/alta e mantém a ocupação e o histórico
das camas. O módulo contém código, exemplos FHIR e migrações. Os testes
automatizados do backend foram removidos nesta fase do projeto.

## Executar

Requisitos: JDK 21 ou superior, Docker e o Maven Wrapper incluído no módulo.
Na pasta `patient-flow-intelligence`, preparar `.env` a partir de `.env.example`
e iniciar a infraestrutura:

```bash
docker compose up -d postgresql keycloak algorithms
cd backend
./mvnw spring-boot:run
```

No PowerShell, usar `./mvnw.cmd` em vez de `./mvnw` e configurar `JAVA_HOME`
para a instalação do JDK. O servidor escuta em `http://localhost:8080`.

A especificação OpenAPI e a interface Swagger UI ficam disponíveis em
`http://localhost:8080/v3/api-docs` e
`http://localhost:8080/swagger-ui.html`. Como alternativa ao backend no host,
é possível executar a aplicação em contentores:

```bash
docker compose up -d --build
```

O comando Compose deve ser executado na pasta `patient-flow-intelligence` e
inicia também o frontend e os serviços de infraestrutura ativos. Não iniciar
simultaneamente outro backend no host na porta 8080.

O OpenAPI declara o esquema HTTP Bearer `bearerAuth`, mas não associa requisitos
de segurança às operações. A opção **Authorize** não deve ser tomada como
garantia de envio do token em todas as chamadas. Para testar pedidos
autenticados, usar os exemplos HTTP abaixo com `Authorization: Bearer <token>`.
O token deve ser obtido pelo cliente web ou por outro cliente autorizado do
realm `patientflow`; o Swagger não cria contas nem clientes Keycloak.

O perfil normal não insere dados de demonstração. Para carregar os cenários
sintéticos numa base nova:

```bash
./mvnw spring-boot:run -Dspring-boot.run.profiles=demo
```

No PowerShell:

```powershell
./mvnw.cmd spring-boot:run '-Dspring-boot.run.profiles=demo'
```

O perfil `demo` ativa `DemoScenarios`, que insere uma ULS, dois hospitais,
três serviços, 22 camas, 60 doentes sintéticos, 52 episódios e oito pedidos
em espera. Os cenários são transacionais e repetíveis, sem repor alterações
nem atribuir acessos ou criar grupos Keycloak. As datas são relativas à
primeira inserção. Ver [DEMO.md](../DEMO.md) para arranque e limitações.

O perfil `demo` não cria a localização dos exemplos FHIR (`Ward 30004`, `Room 7005`,
`Bed MAC`/`Bed MAD`). Para esses exemplos, criar primeiro a hierarquia através
de `/api/hierarchy/{type}`; a ingestão não cria unidades ou camas implicitamente.
Os contratos estão em [OPERATIONS.md](OPERATIONS.md).

Para criar ULS, unidade ou serviço, o backend precisa das credenciais de
administração Keycloak para criar os grupos correspondentes. No host, exportar
as variáveis antes do arranque; com os valores de `.env.example`, no PowerShell:

```powershell
$env:KEYCLOAK_ADMIN_USERNAME = 'admin'
$env:KEYCLOAK_ADMIN_PASSWORD = 'admin'
./mvnw.cmd spring-boot:run
```

Usar os valores efetivos da instalação caso tenham sido alterados. O Compose
de desenvolvimento injeta estas credenciais; o Compose MVP não as injeta.

## Configuração

| Variável | Valor por omissão |
| --- | --- |
| `DB_URL` | `jdbc:postgresql://localhost:5432/patientflow` |
| `DB_USERNAME` | `pfi` |
| `DB_PASSWORD` | `pfi` |
| `KEYCLOAK_ISSUER_URI` | `http://localhost:9080/realms/patientflow` |
| `KEYCLOAK_JWK_SET_URI` (perfil `docker`) | Chaves do Keycloak na rede Docker; issuer externo continua validado |
| `KEYCLOAK_ADMIN_BASE_URL` | `http://localhost:9080` (local) ou `http://keycloak:8080` (Docker) |
| `KEYCLOAK_ADMIN_USERNAME` / `KEYCLOAK_ADMIN_PASSWORD` | Vazias; necessárias para criar grupos Keycloak pela API de hierarquia |
| `KEYCLOAK_ADMIN_REALM` / `KEYCLOAK_ADMIN_CLIENT_ID` | `patientflow` / `admin-cli`; realm dos grupos e cliente do login administrativo |
| `FHIR_SNS_SYSTEM` | `https://www.sns.gov.pt/numero-utente` |
| `FHIR_HOSPITAL_NUMBER_SYSTEM` | `urn:hospital:process-number` |
| `FHIR_VISIT_NUMBER_SYSTEM` | `urn:hospital:visit-number` |
| `WS_ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` |

O backend não carrega automaticamente o `.env` do Docker Compose. Para alterar
os valores acima, exportar as variáveis no processo que inicia o backend ou
usar configuração Spring. `ddl-auto=validate`: apenas o Flyway gere o esquema.
`V2__hospital_domain.sql` contém a hierarquia atual, incluindo serviços sob
pisos e alas sob serviços. Essa migração foi alterada no histórico do projeto;
uma base que tenha aplicado uma versão anterior pode falhar a validação dos
checksums Flyway. Não existe uma migração incremental que converta a hierarquia
antiga para a atual, pelo que o arranque não garante a atualização dessas bases.

`V3__operational_management.sql` acrescenta a gestão operacional, insere um
serviço `GENERAL` por piso existente e associa episódios aos serviços
encontrados pelas suas alocações. A migração exige no máximo um internamento
ativo por doente. `V4__organizational_access.sql` cria a vista de âmbito e a
tabela de grants mantida por compatibilidade,
mas a autorização atual resolve os âmbitos diretamente do claim `groups` do
JWT. Ao criar uma ULS, unidade ou serviço, o backend cria o grupo Keycloak
correspondente e os grupos ficam aninhados. O nome inclui o UUID para permitir
resolução inequívoca, por exemplo
`/ULS_Norte__UUID/UNIT_Hospital_A__UUID/SERVICE_Cardiologia__UUID`.
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

Hierarquia: `ULS → HealthcareUnit → Building → Floor → ClinicalService → Wing → Ward → Room → Bed`.
`Patient → Encounter → LocationAllocation → Bed` regista o internamento e as
suas alocações. Os identificadores internos são UUID; os códigos externos SNS
e de visita não dependem do `id` dos recursos FHIR.

O código da enfermaria é globalmente único nesta primeira versão. Quarto e cama
são únicos dentro do respetivo pai. SNS e número de visita são únicos.
Chaves estrangeiras, validações cronológicas e índices parciais PostgreSQL
impedem referências inválidas e mais de uma alocação aberta por cama ou episódio.
As alocações fechadas permanecem no histórico. Cama, doente e episódio têm
controlo de versão. Cada serviço pertence a um piso e tem código único nesse
piso. Cada ala pertence a um serviço; as enfermarias herdam o serviço da ala.

## API

| Método e caminho | Acesso | Resultado |
| --- | --- | --- |
| `GET /actuator/health` | Público | Estado do serviço |
| `GET /api/account` | Bearer token | Conta e authorities do token |
| `POST /api/fhir/bundles` | Administrador ou gestor com âmbito | `204 No Content` |
| `/api/hierarchy/{type}` | Consulta por âmbito; escrita só administrador | Gestão da hierarquia e dos serviços clínicos |
| `/api/patients`, `/api/beds`, `/api/encounters`, `/api/allocations` | Administrador ou gestor com âmbito; escrita demográfica só administrador | Consultas paginadas e operações documentadas |
| `GET /api/bed-map` | Administrador ou gestor com âmbito | Camas, ocupantes, altas previstas e contagens por estado |
| `/api/admission-requests` | Administrador ou gestor com âmbito | Fila de admissões, prioridades, admissão e cancelamento |
| `GET /api/access/me` | Bearer token | Papéis e associações efetivas do utilizador |
| `/api/access/grants` | Administrador | Consultar/criar/eliminar grants legados; sem efeito na autorização |
| `POST /api/events/tickets` | Administrador ou gestor com âmbito | Bilhete WebSocket de curta duração e uso único |
| `/ws/events?ticket=…` | Bilhete e origem autorizados | Eventos limitados aos papéis/grupos capturados no bilhete |
| `GET /api/analytics/indicators` | Administrador ou gestor com âmbito | Ocupação, internamentos, altas e espera |
| `GET /api/analytics/alerts` | Administrador ou gestor com âmbito | Alertas com causas e limiares configuráveis |
| `GET /api/analytics/occupancy-forecast` | Administrador ou gestor com âmbito | Cenários determinísticos a 24/48 horas, por serviço |
| `GET /api/admission-requests/{id}/bed-suggestions` | Âmbito do pedido | Sugestões explicáveis de camas livres |

A ingestão aceita `application/json` e `application/fhir+json`. O administrador
tem acesso global; os gestores precisam do papel Keycloak e de uma associação
organizacional compatível no claim `groups` do JWT. A atribuição faz-se no
Keycloak e exige renovar o token; `/api/access/grants` não concede permissões.
Consultas, contagens, operações e eventos respeitam esse âmbito.
A matriz de permissões, atribuição
inicial de acessos e protocolo de reconexão estão em [SECURITY.md](SECURITY.md).
Fórmulas, critérios, limites e configuração estão em [ANALYTICS.md](ANALYTICS.md).
O frontend já consulta hierarquia, camas, ocupantes e episódios. O dashboard
mantém dados fixos e não há consumo das APIs analíticas nem dos eventos
WebSocket pelo frontend. Modelos treinados são trabalho futuro do [plano](PLAN.md).

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

Os quatro ficheiros em `examples/fhir` permitem verificar a ingestão manualmente:

| Ficheiros | Formato |
| --- | --- |
| `admission.json`, `discharge.json` | Identificadores hospitalares por sistema/tipo, `actualPeriod` e localização textual |
| `admission-locations.json`, `discharge-locations.json` | Sistemas configurados, `period` e recursos `Location` separados |

Na pasta `backend`, com a localização dos exemplos criada manualmente e um
access token de administrador ou de gestor com âmbito compatível do realm
`patientflow` (o perfil `demo`, por si só, não cria essa localização):

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

Os testes automatizados do backend, os recursos em `src/test` e as dependências
Maven exclusivas dos testes foram removidos nesta fase. Os exemplos FHIR acima
continuam disponíveis para verificação manual da API.

Os testes Python do serviço de algoritmos mantêm-se no respetivo módulo;
ver [algorithms/README.md](../algorithms/README.md).
O script `python scripts/verify_mvp.py`, executado em `patient-flow-intelligence`,
também mantém suposições antigas de grants e 24 camas; limitações em
[DEMO.md](../DEMO.md#validação).

O [plano](PLAN.md) descreve apenas trabalho futuro sobre modelos inteligentes.
