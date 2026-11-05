# Demonstração do backend e algoritmos

O `compose.mvp.yml` define um ambiente separado para consultar o backend e
os algoritmos, sem frontend. As decisões usam regras determinísticas `rules-v1`;
modelos treinados são trabalho futuro descrito em [PLAN.md](backend/PLAN.md).
O arranque não lê ficheiros de `assets`.

O cenário atual contém 22 camas. O seed mínimo dos exemplos FHIR está
desativado e a atribuição de acessos usa grupos Keycloak. Os scripts de
validação ainda usam o antigo mecanismo de grants e esperam 24 camas;
não constituem uma validação automática aprovada deste estado do projeto.

## Arranque autónomo

Requer Docker Desktop/Engine com Compose v2. Na pasta `patient-flow-intelligence`:

```sh
docker compose --env-file .env.example -f compose.mvp.yml -p patientflow-mvp up -d --build --wait --wait-timeout 300
```

Esta configuração inclui apenas PostgreSQL 16, Keycloak 26.4, algorithms e
backend Java 21. Tem rede e volume próprios; pode coexistir
com a infraestrutura de desenvolvimento. O primeiro build descarrega imagens e
dependências e demora mais. O estado mantém-se nos reinícios.

Usar uma base nova para este cenário. A migração V2 foi alterada e não existe
conversão incremental da hierarquia antiga; uma base de uma versão anterior
pode falhar a validação Flyway. Detalhes em [backend/README.md](backend/README.md#configuração).
O build da imagem omite a compilação e execução dos testes Java.

| Recurso | URL |
| --- | --- |
| API | http://localhost:18080/api |
| Health | http://localhost:18080/actuator/health |
| Keycloak | http://localhost:19080 |

As portas são configuráveis por `MVP_API_PORT` e `MVP_KEYCLOAK_PORT`.
Usar `localhost` para obter os tokens, para coincidir com o issuer configurado.
O perfil `docker` obtém as chaves públicas pelo endereço interno do Keycloak,
mantendo a validação do issuer externo presente no JWT. O WebSocket é acedido
diretamente em `ws://localhost:18080/ws/events?ticket=…`; a origem autorizada
nesta configuração é `http://localhost:18080` e acompanha `MVP_API_PORT`.
Não é necessário instalar Node, arrancar o frontend ou configurar nginx.

Credenciais de demonstração (password igual ao utilizador):

| Utilizador | Papel Keycloak | Associação sugerida |
| --- | --- | --- |
| `demo-admin` | `ROLE_ADMIN` | Global; não precisa de associação |
| `demo-lhu` | `LHU_MANAGER` | ULS Demonstração |
| `demo-unit` | `UNIT_MANAGER` | Hospital Demonstração Centro |
| `demo-service` | `SERVICE_MANAGER` | Medicina — pressão assistencial (`DEMO-MED`) |
| `demo-other` | `UNIT_MANAGER` | Hospital Demonstração Norte |

O administrador da consola Keycloak é `admin`, password `patientflow-demo`,
configurável por `MVP_KEYCLOAK_ADMIN_PASSWORD`. A password PostgreSQL é
`patientflow-demo`, configurável por `MVP_DB_PASSWORD`. Estes valores e o
password grant do cliente são exclusivos desta demonstração local. A configuração
do realm de desenvolvimento existente em `keycloak/realm` mantém-se separada.
O cliente público `backend_demo` tem Direct Access Grants ativado para os testes
locais, sem login de browser, redirects ou origens de frontend.

Keycloak importa o realm apenas se ainda não existir. Se reutilizar um volume
da demonstração anterior e o cliente `backend_demo` não existir, criá-lo como
cliente público com Direct Access Grants na consola Keycloak, ou usar um novo
nome de projeto e portas livres. Não é necessário eliminar dados existentes.

## Consultar a API

Exemplo no PowerShell, após o arranque, usando o administrador de demonstração:

```powershell
$auth = Invoke-RestMethod -Method Post -Uri 'http://localhost:19080/realms/patientflow/protocol/openid-connect/token' -Body @{
    grant_type = 'password'
    client_id = 'backend_demo'
    username = 'demo-admin'
    password = 'demo-admin'
}
$headers = @{ Authorization = "Bearer $($auth.access_token)" }
Invoke-RestMethod -Uri 'http://localhost:18080/api/analytics/indicators' -Headers $headers
Invoke-RestMethod -Uri 'http://localhost:18080/api/bed-map?size=10' -Headers $headers
```

Os tokens expiram; obter um novo token quando necessário. Nos exemplos seguintes,
usar os cabeçalhos do utilizador correspondente. O administrador tem acesso
global; um gestor sem papel/grupo compatível no JWT recebe `403` nas consultas
operacionais. As consultas administrativas não exigem configurar grupos.

## Atribuir os âmbitos

Todos os utilizadores e papéis da tabela já são importados no Keycloak.
Nenhum gestor recebe associações organizacionais automaticamente. O seed usa
SQL direto e não cria grupos Keycloak. O realm em `keycloak/demo` também não
inclui o mapper de grupos necessário aos gestores. Para preparar estes acessos:

1. Obter um token de `demo-admin` como no exemplo anterior.
2. Consultar `/api/hierarchy/ULS`, `/api/hierarchy/UNIT` e `/api/hierarchy/SERVICE`
   com o token do administrador e obter o UUID da entidade pretendida.
3. Na administração do realm `patientflow`, criar os grupos ULS → UNIT → SERVICE
   correspondentes aos dados existentes. Usar os nomes
   `ULS_Demonstracao__UUID_ULS`, `UNIT_Centro__UUID_UNIDADE` e
   `SERVICE_Medicina__UUID_SERVICO`, substituindo os marcadores pelos UUID reais.
   Criar também o grupo da unidade Norte se for testar `demo-other`.
4. Associar cada gestor ao grupo do tipo indicado na tabela de utilizadores.
   Os papéis da tabela já estão atribuídos.
5. Configurar um mapper **Group Membership** para o cliente `backend_demo`,
   diretamente ou num client scope atribuído por omissão: claim `groups`,
   `full.path=true` e inclusão no access token. O token deve conter uma lista
   de caminhos completos dos grupos.
6. Obter novos tokens dos gestores e consultar `/api/access/me`, indicadores e
   camas. O acesso efetivo é a combinação do papel com os UUID dos grupos.

Os IDs importados terminam em `0001` a `0005`, respetivamente para admin, unit,
service, other e lhu: `10000000-0000-0000-0000-00000000000N`.
Estes IDs são identidades de utilizadores, não UUID de entidades hospitalares.

Para retirar acesso, remover o grupo ou papel no Keycloak e obter novo token.
Tokens anteriores e ligações WebSocket podem continuar autorizados até à
expiração do JWT. `POST/DELETE /api/access/grants` apenas altera registos
legados e não concede nem revoga permissões. Detalhes em
[backend/SECURITY.md](backend/SECURITY.md).

O `compose.mvp.yml` não injeta `KEYCLOAK_ADMIN_USERNAME` nem
`KEYCLOAK_ADMIN_PASSWORD` no backend. Consultas e o seed SQL não dependem
dessas credenciais, mas criar ULS/unidade/serviço pela API exige disponibilizá-las
no contentor. Exportá-las apenas no host não as encaminha para este serviço
Compose. Até configurar o ambiente do contentor, preparar os grupos existentes
manualmente na consola Keycloak.

## Cenários sintéticos

Numa base nova, o perfil `demo` ativa `DemoScenarios` e cria uma ULS com dois
hospitais e três serviços, com a hierarquia
ULS → unidade → edifício → piso → serviço → ala → enfermaria → quarto → cama:

| Serviço | Camas | Ocupadas | Livres | Limpeza | Bloqueadas | Pedidos em espera |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| DEMO-MED / Centro | 8 | 7 | 0 | 0 | 1 | 6 |
| DEMO-ORT / Centro | 8 | 2 | 3 | 2 | 1 | 1 |
| DEMO-NORTE / Norte | 6 | 1 | 4 | 1 | 0 | 1 |
| **Total** | **22** | **10** | **7** | **3** | **2** | **8** |

São 60 doentes sintéticos, 10 episódios ativos e 42 terminados, com 14 dias
de histórico de altas. Os internamentos ativos podem ser mais antigos,
chegando a 20 dias no cenário de pressão. Existe histórico sem sobreposição
de alocações, altas clínicas pendentes, altas previstas, internamentos prolongados,
urgências em espera e admissões programadas. O serviço de pressão apresenta
100% de ocupação sobre a capacidade utilizável (a cama bloqueada é excluída).
Não confundir capacidade com número total de camas; fórmulas em
[ANALYTICS.md](backend/ANALYTICS.md).

Datas são relativas ao primeiro arranque. O seed usa IDs estáveis e uma transação
com bloqueio; não repõe o cenário nem sobrescreve alterações operacionais nos
arranques seguintes. Os indicadores evoluem com o tempo e com as operações.
O perfil normal não insere dados. O antigo `DataSeeder.java` está totalmente
comentado: `PATIENTFLOW_DEMO_DATA=true`, isoladamente, não insere hierarquia.
Os exemplos FHIR de `backend/examples/fhir` referem `Ward 30004`, `Room 7005`
e `Bed MAC`/`Bed MAD`, que já não são criados automaticamente. Antes de enviar
esses bundles, criar a localização pela API de hierarquia com as credenciais
administrativas Keycloak configuradas, ou adaptar os códigos dos bundles a
camas livres existentes. Contrato em [OPERATIONS.md](backend/OPERATIONS.md).

A API expõe indicadores, alertas, cenários 24/48h, mapa paginado e consultas
por âmbito. A resposta analítica identifica a alternativa local perante
indisponibilidade dos algoritmos; campos sem amostras mantêm o valor `null`.
Admissões, altas, limpeza, edição da hierarquia e ingestão FHIR estão documentadas
em [OPERATIONS.md](backend/OPERATIONS.md) e [README.md](backend/README.md).
O backend disponibiliza bilhetes e eventos WebSocket diretamente. Este Compose
não executa frontend. Na aplicação de desenvolvimento, a integração já inclui
hierarquia, camas, ocupantes e episódios; o dashboard mantém dados de exemplo
e ainda não consome os endpoints analíticos nem os eventos WebSocket.

## Validação

Os resultados anteriormente registados em 25-10-2026 (86 testes Java, sete
testes Python e fluxo Docker aprovado) referem-se a uma versão anterior.
Não representam aprovação da hierarquia e da autorização atuais.

Para verificar as regras Python, na pasta `algorithms`, sem FastAPI ou Docker:

```sh
python -m unittest discover -s tests -p test_decision_rules.py -v
```

São cinco testes. Os dois testes HTTP adicionais requerem uma API em execução
e `ALGORITHMS_TEST_URL`; ver [algorithms/README.md](algorithms/README.md).
Com o ambiente MVP em execução, podem ser executados dentro do serviço:

```sh
docker compose --env-file .env.example -f compose.mvp.yml -p patientflow-mvp exec -T -e ALGORITHMS_TEST_URL=http://localhost:8000 algorithms python -m unittest discover -s tests -v
```

O script `scripts/verify_mvp.py` continua no repositório e requer Python 3.11+
e Docker. Cria um projeto `pfi-verify-…` com portas livres e volume temporário,
constrói os serviços e chama `smoke_mvp.py`. Ainda precisa de adaptação:

- Espera 24 camas e a hierarquia mínima desativada.
- Concede acessos e testa revogação por `/api/access/grants`, que já não autoriza.
- Usa o realm demo sem mapper/grupos organizacionais preparados.

Por isso, `python scripts/verify_mvp.py` não deve ser usado como critério de
aprovação atual. O script tenta remover os contentores, rede e volume do seu
projeto temporário no final. Guarda relatórios em `.validation/pfi-verify-…/`;
um `result.json` de sucesso só é escrito se todas as verificações passarem.

O ponto de entrada dos testes Java continua a ser:

```sh
cd backend
./mvnw test
```

No PowerShell usar `./mvnw.cmd`. A suite depende de `DataSeeder`, atualmente
comentado, pelo que a compilação dos testes está bloqueada. As topologias,
fixtures e preparação de acessos também mantêm o contrato antigo. A criação
de grupos introduziu uma dependência da administração Keycloak que a suite
não substitui. Detalhes em [backend/README.md](backend/README.md#testes).

## Parar a demonstração

```sh
docker compose --env-file .env.example -f compose.mvp.yml -p patientflow-mvp down
```

O volume e o estado persistem. Para repetir com o cenário inicial, usar outro
nome de projeto e portas livres. Não é necessário remover volumes existentes.
RabbitMQ, Redis, HAPI FHIR e MinIO são serviços opcionais da infraestrutura
alargada; o fluxo atual de ingestão é HTTP direto para o backend.
