# Demonstração e validação do MVP — etapa 8

Os exemplos, cenários, testes e configurações necessários estão no projeto.
O arranque não lê ficheiros de `assets`. As decisões atuais usam `rules-v1`;
os modelos treinados continuam exclusivamente no passo 10, futuro. A integração
com o frontend fica planeada no passo 9 e não é executada nesta demonstração.

## Arranque autónomo

Requer Docker Desktop/Engine com Compose v2. Na pasta `patient-flow-intelligence`:

```sh
docker compose --env-file .env.example -f compose.mvp.yml -p patientflow-mvp up -d --build --wait --wait-timeout 300
```

Esta configuração inclui apenas PostgreSQL 16, Keycloak 26.4, algorithms e
backend Java 21. Tem rede e volume próprios; pode coexistir
com a infraestrutura de desenvolvimento. O primeiro build descarrega imagens e
dependências e demora mais. O estado mantém-se nos reinícios.

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

| Utilizador | Papel Keycloak | Grupo sugerido |
| --- | --- | --- |
| `demo-admin` | `ADMIN_ROLE` | Global; não precisa de associação |
| `demo-lhu` | `MANAGER_ROLE` | Grupo da ULS Demonstração |
| `demo-unit` | `MANAGER_ROLE` | Grupo do Hospital Demonstração Centro |
| `demo-service` | `MANAGER_ROLE` | Grupo do serviço Medicina (`DEMO-MED`) |
| `demo-other` | `MANAGER_ROLE` | Grupo do Hospital Demonstração Norte |

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
global; um gestor sem associação recebe `403` nas consultas operacionais.

## Atribuir os âmbitos

Todos os utilizadores e papéis da tabela já são importados no Keycloak. Os
gestores precisam de ser associados a grupos organizacionais no Keycloak.

1. Criar os elementos da hierarquia pela API autenticada como administrador;
   os grupos Keycloak são criados automaticamente até à enfermaria.
2. Na consola Keycloak, atribuir ao gestor o grupo apropriado e o papel
   `MANAGER_ROLE`.
3. Renovar o token e consultar `/api/access/me` para verificar o âmbito
   efetivo. Se existirem associações em vários níveis, só o nível mais
   específico é aplicado.
4. Consultar indicadores, camas e restantes recursos com o token do gestor:
   os filtros não ampliam o acesso. Dados sem associação a uma enfermaria não
   são disponibilizados a um gestor limitado a grupos de enfermaria.

Os IDs importados terminam em `0001` a `0005`, respetivamente para admin, unit,
service, other e lhu: `10000000-0000-0000-0000-00000000000N`. A criação de
identidades, a atribuição do papel e a associação a grupos fazem-se no
Keycloak. O contrato completo está em [backend/SECURITY.md](backend/SECURITY.md).

## Cenários sintéticos

Numa base nova, o perfil `demo` cria a hierarquia mínima dos exemplos FHIR e
uma ULS adicional com dois hospitais e três serviços:

| Serviço | Camas | Ocupadas | Livres | Limpeza | Bloqueadas | Pedidos em espera |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| DEMO-MED / Centro | 8 | 7 | 0 | 0 | 1 | 6 |
| DEMO-ORT / Centro | 8 | 2 | 3 | 2 | 1 | 1 |
| DEMO-NORTE / Norte | 6 | 1 | 4 | 1 | 0 | 1 |
| Medicina / Hospital Principal (FHIR) | 2 | 0 | 2 | 0 | 0 | 0 |
| **Total** | **24** | **10** | **9** | **3** | **2** | **8** |

São 60 doentes sintéticos, 10 episódios ativos e 42 terminados, distribuídos
pelos 14 dias anteriores ao primeiro arranque. Existe histórico sem sobreposição
de alocações, altas clínicas pendentes, altas previstas, internamentos prolongados,
urgências em espera e admissões programadas. O serviço de pressão apresenta
100% de ocupação sobre a capacidade utilizável (a cama bloqueada é excluída).
Não confundir capacidade com número total de camas; fórmulas em
[ANALYTICS.md](backend/ANALYTICS.md).

Datas são relativas ao primeiro arranque. O seed usa IDs estáveis e uma transação
com bloqueio; não repõe o cenário nem sobrescreve alterações operacionais nos
arranques seguintes. Os indicadores evoluem com o tempo e com as operações.
O perfil normal não insere dados. Para apenas a hierarquia mínima, usar
`PATIENTFLOW_DEMO_DATA=true`, sem perfil `demo`.

A API expõe indicadores, alertas, cenários 24/48h, mapa paginado e consultas
por âmbito. A resposta analítica identifica a alternativa local perante
indisponibilidade dos algoritmos; campos sem amostras mantêm o valor `null`.
Admissões, altas, limpeza, edição da hierarquia e ingestão FHIR estão documentadas
em [OPERATIONS.md](backend/OPERATIONS.md) e [README.md](backend/README.md).
O cliente de teste também obtém bilhetes e verifica os eventos WebSocket
diretamente no backend. Não existe integração com o frontend nesta etapa.

## Validação automática integrada

Validação executada em 25-10-2026:

| Verificação | Resultado |
| --- | --- |
| Java: parser, PostgreSQL/HTTP, migração V2→V5, concorrência, segurança, eventos, indicadores e cenários | 86 aprovados |
| Python: regras e contrato HTTP com FastAPI em execução | 7 aprovados |
| Stack Docker com Java 21 e Keycloak reais, sem frontend | Fluxo operacional, permissões e WebSocket direto aprovados |
| Algorithms parado e backend reiniciado | Alternativa local e preservação do estado aprovadas |

Requer Python 3.11+ e Docker em execução. Sem Node ou bibliotecas Python adicionais:

```sh
python scripts/verify_mvp.py
```

O comando gera um projeto `pfi-verify-…` com portas livres e volume novos;
compila o backend e verifica diretamente as APIs e o WebSocket:

- Migrações e arranque real com Java 21, PostgreSQL, Keycloak e Python.
- Autenticação com JWT reais dos cinco utilizadores, através do cliente `backend_demo`.
- Associação inicial, totais por âmbito, negações 401/403/404 e isolamento.
- Indicadores de pressão, sugestões e cenários produzidos pelo serviço Python.
- Pedido → sugestão de cama → admissão idempotente → previsão de alta → alta
  clínica → alta administrativa → limpeza concluída e histórico fechado.
- WebSocket direto: upgrade, `RESYNC_REQUIRED`, evento de admissão
  após commit e encerramento quando o administrador revoga o acesso.
- Testes Python, incluindo o contrato HTTP do serviço em execução.
- Alternativa local após parar algorithms e preservação dos dados após reiniciar o backend:
  pedido admitido, episódio terminado, limpeza concluída, histórico fechado e acesso revogado.

No final remove apenas os contentores, rede e volume desse projeto temporário.
Os relatórios ficam em `.validation/pfi-verify-…/` (ignorado pelo Git), sem tokens
ou passwords. As portas de teste são locais. `--docker` permite indicar o
executável fora do PATH. Os relatórios incluem `api-snapshot.json`,
`api-degraded.json`, `api-after-restart.json` e `result.json`.
O teste é independente dos ficheiros e ferramentas do frontend.

As verificações aprofundadas de concorrência, rollback, migração V2→V5,
expiração e isolamento de eventos continuam nos testes Java:

```sh
cd backend
./mvnw test
```

No PowerShell usar `./mvnw.cmd`. Testcontainers usa PostgreSQL temporário e
não toca nos volumes de desenvolvimento. A suite Java não precisa de Keycloak:
substitui o decoder apenas nos testes; o script Docker verifica separadamente
os JWT e os papéis com o Keycloak real.

## Parar a demonstração

```sh
docker compose --env-file .env.example -f compose.mvp.yml -p patientflow-mvp down
```

O volume e o estado persistem. Para repetir com o cenário inicial, usar outro
nome de projeto e portas livres. Não é necessário remover volumes existentes.
RabbitMQ, Redis, HAPI FHIR e MinIO são serviços opcionais da infraestrutura
alargada; o fluxo atual de ingestão é HTTP direto para o backend.
