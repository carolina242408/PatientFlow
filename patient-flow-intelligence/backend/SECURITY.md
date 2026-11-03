# Permissões organizacionais e eventos — etapa 6

## Identidade e âmbito

O JWT é validado pelo resource server contra o issuer Keycloak configurado.
Os papéis são lidos das authorities derivadas de `realm_access.roles` e os
âmbitos são lidos do claim `groups`. Os grupos organizacionais incluem o UUID
da entidade no nome (`ULS_<nome>__<uuid>`, `UNIT_<nome>__<uuid>` e
`SERVICE_<nome>__<uuid>`), pelo que a associação é resolvida sem consultar
`/api/access/grants`.

Um gestor precisa simultaneamente de papel e associação do tipo correspondente:

| Papel Keycloak | Tipo de associação | Âmbito efetivo |
| --- | --- | --- |
| `ROLE_ADMIN` | Não exige associação | Global |
| `LHU_MANAGER` | `ULS` | Unidades e serviços dessa ULS |
| `UNIT_MANAGER` | `UNIT` | Serviços dessa unidade |
| `SERVICE_MANAGER` | `SERVICE` | Serviço e suas enfermarias/camas |

É possível atribuir vários âmbitos; o acesso efetivo é a união dos grupos
compatíveis com os papéis presentes no JWT. Um grupo `UNIT` sem papel
`UNIT_MANAGER` não concede esse acesso. Ao criar ULS, unidade ou serviço pela
API de hierarquia, o backend cria o grupo Keycloak correspondente.

## Matriz de operações

| Operação | Administrador | Gestor com associação compatível |
| --- | --- | --- |
| Conta e acesso próprio | Sim | Sim; acesso próprio também disponível sem associação |
| Gestão de associações de acesso | Global | Não |
| Consultar hierarquia | Global | Elementos do âmbito e respetivos antecessores |
| Criar/alterar/remover hierarquia e serviços | Global | Não |
| Consultar doentes | Global | Doentes com episódio ou pedido de admissão no âmbito |
| Registar/corrigir dados demográficos por API | Global | Não |
| Consultar camas, mapa, episódios, alocações e filas | Global | Apenas âmbito atribuído |
| Estado operacional das camas e gestão de altas | Global | Apenas âmbito atribuído |
| Criar/gerir/admitir/cancelar pedidos de admissão | Global | Serviço, doente e cama autorizados |
| Ingestão FHIR | Global | Cama de destino e episódio existente autorizados |
| Eventos WebSocket | Global | Apenas alterações relevantes ao âmbito atual |
| Indicadores, alertas e cenários de ocupação | Global | Apenas agregados do âmbito atribuído |
| Sugestões de camas | Global | Pedido, serviço e camas autorizados |

Dados demográficos são partilhados entre internamentos do mesmo doente; as
correções são reservadas ao administrador para evitar alterações globais por
um gestor de um único serviço. A ingestão FHIR pode registar um doente no
contexto de uma admissão autorizada, preservando dados demográficos existentes.
Um doente registado sem episódio/pedido associado é visível apenas ao administrador.
Este pode criar o primeiro pedido de admissão para o serviço de destino.

As restrições são aplicadas às linhas e aos totais nas consultas SQL, e aos
recursos nas operações de escrita. `ulsId`, `unitId`, `serviceId`, `wardId` e
outros filtros apenas restringem os resultados; nunca ampliam as permissões.
O histórico de um doente continua filtrado episódio a episódio/alocação a alocação.
O serviço `algorithms` recebe apenas candidatos ou contagens já limitados ao
âmbito autorizado; não recebe JWT, nomes, SNS, datas de nascimento nem dados
demográficos. Os identificadores e resultados devolvidos são validados pelo backend.

Sem autenticação, a API responde `401`. Sem papel/associação operacional,
responde `403`. Um recurso individual desconhecido ou fora do âmbito devolve
`404`, impedindo a distinção por enumeração de identificadores. Uma coleção
filtrada para outro âmbito fica vazia. A gestão de associações devolve `403`
para utilizadores sem `ROLE_ADMIN`.

## Atribuição inicial de acessos

1. Criar a ULS, unidade e serviço através da API de hierarquia. O backend cria
   os grupos aninhados no Keycloak.
2. Atribuir o utilizador ao grupo correspondente no Keycloak e atribuir-lhe o
   papel `LHU_MANAGER`, `UNIT_MANAGER` ou `SERVICE_MANAGER`.
3. Renovar o token do utilizador. O claim `groups` passa a conter o caminho
   do grupo e o acesso é aplicado sem grant na base de dados.

```http
<!-- Legacy grant API is not used for authorization. -->
Authorization: Bearer ACCESS_TOKEN_ADMIN
Content-Type: application/json

{
  "subject":"SUB_KEYCLOAK_DO_GESTOR",
  "type":"UNIT",
  "scopeId":"UUID_DA_UNIDADE"
}
```

O realm deve ter um mapper de grupos com `full.path=true` no claim `groups`.
O ficheiro `keycloak/realm/patientflow-realm.json` configura esse mapper e
inclui o client scope nos scopes por omissão de `web_app`. Se o realm já tiver
sido importado, é necessário reaplicar/importar essa configuração.

| Método e caminho | Resultado |
| --- | --- |
| `GET /api/access/me` | `subject`, `roles`, `administrator` e âmbitos derivados do JWT |

Alterações aos grupos ou papéis no Keycloak refletem-se num novo token; a
validade do JWT limita a duração da ligação existente.

## WebSocket autenticado

O browser obtém um bilhete com o seu Bearer token:

```http
POST /api/events/tickets
Authorization: Bearer ACCESS_TOKEN
```

```json
{
  "ticket":"VALOR_ALEATORIO_DE_USO_UNICO",
  "expiresAt":"2026-10-25T16:30:30Z",
  "path":"/ws/events"
}
```

Abrir a ligação no backend: `ws://localhost:8080/ws/events?ticket=…`.
Em HTTPS usar `wss`. O bilhete é aleatório, de uso único e tem validade de
30 segundos, limitada pela expiração do JWT. O Bearer token não é colocado
no URL nem guardado na sessão WebSocket. A resposta do bilhete usa `Cache-Control: no-store`.

`WS_ALLOWED_ORIGINS` define as origens explícitas, por omissão
`http://localhost:5173,http://127.0.0.1:5173`; wildcards são rejeitados.
Um proxy que exponha `/ws/events` deve encaminhar o upgrade WebSocket para o
backend. No desenvolvimento atual, o browser pode ligar diretamente à porta
8080, mantendo a origem 5173 autorizada.

Não é necessário enviar subscrições: o servidor calcula o conjunto de eventos
permitidos a partir dos papéis e associações atuais. Mensagens de texto do
cliente não podem escolher outros tópicos e encerram a ligação com código 1008.
Ligação sem bilhete válido é rejeitada; o mesmo bilhete não pode ser reutilizado.

O servidor verifica a autorização em cada envio e revê as ligações a cada
segundo, encerrando-as na expiração do JWT ou perda de autorização. Após renovar
o token, obter novo bilhete e abrir nova ligação.

## Eventos e recuperação do estado

Exemplo de mensagem:

```json
{
  "id":"UUID_DO_EVENTO",
  "type":"BED_STATUS_CHANGED",
  "occurredAt":"2026-10-25T16:30:00Z",
  "resourceType":"BED",
  "resourceId":"UUID_DA_CAMA"
}
```

As mensagens são notificações de alteração: incluem identificadores e tipo,
sem dados clínicos, nomes de doentes, tokens ou âmbitos de outros utilizadores.
O cliente volta a consultar a API autorizada para obter os dados atuais.

| Tipo | Alteração |
| --- | --- |
| `PATIENT_ADMITTED`, `PATIENT_DISCHARGED` | Internamento/alta administrativa, incluindo ocupação da cama |
| `PATIENT_CREATED`, `PATIENT_UPDATED` | Registo/correção demográfica |
| `BED_STATUS_CHANGED` | Estado operacional da cama |
| `DISCHARGE_PLAN_CHANGED`, `CLINICAL_DISCHARGE_RECORDED` | Planeamento/alta clínica |
| `ADMISSION_REQUEST_CREATED`, `ADMISSION_REQUEST_UPDATED` | Criação/alteração de pedido |
| `ADMISSION_REQUEST_ADMITTED`, `ADMISSION_REQUEST_CANCELLED` | Encerramento de pedido |
| `HIERARCHY_CREATED`, `HIERARCHY_UPDATED`, `HIERARCHY_DELETED` | Estrutura e serviços |
| `ACCESS_CHANGED` | Associação de acesso; administrador e utilizador afetado |

Os eventos são enviados por listener `AFTER_COMMIT`. Operações revertidas e
reenvios sem alterações não emitem eventos. Uma falha de entrega não altera
o resultado de uma transação já confirmada. Audiências de remoções são
capturadas antes de eliminar o elemento.

Ao estabelecer qualquer ligação, o servidor envia `RESYNC_REQUIRED` com
`resourceType: SNAPSHOT`. O cliente deve:

1. Abrir a ligação e começar a receber notificações.
2. Recarregar as consultas REST necessárias, respeitando a paginação.
3. Se chegarem alterações durante esse carregamento, voltar a atualizar a vista.
4. Repetir o procedimento após cada reconexão; usar o UUID do evento para
   deduplicação de notificações durante a ligação.

As notificações são transitórias e locais ao processo. Não existe replay
durável de eventos; a API persistida é a fonte de recuperação após falhas ou
reinícios. Uma execução distribuída exigiria transporte partilhado, fora do
âmbito deste backend MVP.

## Validação

Os testes integram PostgreSQL, servidor HTTP real e clientes WebSocket reais.
Cobrem papéis sem associação, tipos incompatíveis, tentativas de gerir acessos
como gestor, isolamento entre ULS/unidades/serviços, totais e identificadores,
FHIR e filas fora do âmbito, revogação, origens, bilhete de uso único, expiração
do JWT, reconexão, eventos após commit e supressão em rollback/reenvios.
