# Permissões organizacionais e eventos

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
| API legada de grants | Global; não altera a autorização efetiva | Não |
| Consultar hierarquia | Global | Níveis permitidos pelo papel, conforme indicado abaixo |
| Criar/alterar/remover hierarquia e serviços | Global | Não |
| Consultar doentes | Global | Doentes com episódio ou pedido de admissão no âmbito |
| Registar/corrigir dados demográficos por API | Global | Não |
| Consultar camas, mapa, episódios, alocações e filas | Global | Apenas âmbito atribuído |
| Estado operacional das camas e gestão de altas | Global | Apenas âmbito atribuído |
| Criar/gerir/admitir/cancelar pedidos de admissão | Global | Serviço, doente e cama autorizados |
| Ingestão FHIR | Global | Cama de destino e episódio existente autorizados |
| Eventos WebSocket | Global | Alterações relevantes aos papéis/grupos capturados no bilhete |
| Indicadores, alertas e cenários de ocupação | Global | Apenas agregados do âmbito atribuído |
| Sugestões de camas | Global | Pedido, serviço e camas autorizados |

Na consulta da hierarquia, um `LHU_MANAGER` vê a sua ULS e os descendentes;
um `UNIT_MANAGER` vê a unidade e os descendentes, mas não a ULS; um
`SERVICE_MANAGER` vê o serviço e os descendentes, mas não os níveis ULS,
unidade, edifício ou piso. Não existe acesso automático a todos os antecessores.
Combinar papéis e grupos pode acrescentar esses níveis.

Dados demográficos são partilhados entre internamentos do mesmo doente; as
correções são reservadas ao administrador para evitar alterações globais por
um gestor de um único serviço. A ingestão FHIR pode registar um doente no
contexto de uma admissão autorizada, preservando dados demográficos existentes.
Um doente registado sem episódio/pedido associado é visível apenas ao administrador.
Este pode criar o primeiro pedido de admissão para o serviço de destino.

As restrições são aplicadas às linhas e aos totais nas consultas SQL, e aos
recursos nas operações de escrita. Os filtros suportados por cada endpoint
apenas restringem os resultados; nunca ampliam as permissões. Os campos
partilhados no DTO não são todos aplicados por todas as consultas; consultar
[OPERATIONS.md](OPERATIONS.md#convenções) e [ANALYTICS.md](ANALYTICS.md#api-e-autorização).
O histórico de um doente continua filtrado episódio a episódio/alocação a alocação.
O serviço `algorithms` recebe apenas candidatos ou contagens já limitados ao
âmbito autorizado; não recebe JWT, nomes, SNS, datas de nascimento nem dados
demográficos. Os identificadores e resultados devolvidos são validados pelo backend.

Sem autenticação, as rotas protegidas respondem `401`. Sem papel/associação operacional,
responde `403`. Um recurso individual desconhecido ou fora do âmbito devolve
`404`, impedindo a distinção por enumeração de identificadores. Uma coleção
filtrada para outro âmbito fica vazia. A API legada de grants devolve `403`
para utilizadores sem `ROLE_ADMIN`.

## Atribuição inicial de acessos

1. Configurar `KEYCLOAK_ADMIN_BASE_URL`, `KEYCLOAK_ADMIN_USERNAME` e
   `KEYCLOAK_ADMIN_PASSWORD` no backend. As credenciais permitem obter um token
   administrativo no realm `master` para criar grupos no realm `patientflow`.
   O Compose de desenvolvimento injeta as credenciais de `.env`; o backend
   iniciado no host não lê esse ficheiro automaticamente.
2. Criar a hierarquia através da API: ULS → unidade → edifício → piso → serviço.
   O backend cria os grupos aninhados para ULS, unidade e serviço. Dados
   inseridos diretamente por SQL, incluindo os cenários de demonstração, não
   passam por essa criação de grupos. Para esses dados, criar os grupos no
   Keycloak com os UUID reais, por exemplo:

   ```text
   /ULS_Demonstracao__UUID_ULS/UNIT_Centro__UUID_UNIDADE/SERVICE_Medicina__UUID_SERVICO
   ```

   Substituir os marcadores por UUID completos. A resolução usa o prefixo de
   tipo e o UUID após `__`; os nomes intermédios são descritivos.
3. Atribuir o utilizador ao grupo correspondente no Keycloak e atribuir-lhe o
   papel `LHU_MANAGER`, `UNIT_MANAGER` ou `SERVICE_MANAGER`.
4. Configurar o mapper de grupos indicado abaixo e renovar o token do utilizador.
   O claim `groups` passa a conter o caminho
   do grupo e o acesso é aplicado sem grant na base de dados.

O realm deve ter um mapper de grupos com `full.path=true` no claim `groups`.
O ficheiro `keycloak/realm/patientflow-realm.json` configura esse mapper e
inclui o client scope nos scopes por omissão de `web_app`. Se o realm já tiver
sido importado, aplicar as alterações pela administração do Keycloak; a
importação de arranque não sobrescreve um realm existente. O realm separado
em `keycloak/demo` não inclui esse mapper: configurá-lo para `backend_demo`
antes de testar os gestores, conforme [DEMO.md](../DEMO.md#atribuir-os-âmbitos).

| Método e caminho | Resultado |
| --- | --- |
| `GET /api/access/me` | `subject`, `roles`, `administrator` e âmbitos derivados do JWT |

Os elementos de `scopes` nesta resposta representam grupos efetivos, com
`grantedBy=KEYCLOAK_GROUP`, `grantedAt` no instante Unix zero e IDs gerados
por consulta. Esses IDs não correspondem a registos de grants persistidos.

`GET/POST /api/access/grants` e `DELETE /api/access/grants/{id}` continuam
disponíveis para administradores por compatibilidade com a tabela
`user_scope_grants`. Criar ou eliminar esses registos não concede nem revoga
acessos operacionais e não altera os grupos no Keycloak. A atribuição efetiva
e a remoção de associações são feitas no Keycloak.

Alterações aos grupos ou papéis no Keycloak refletem-se num novo token. O
backend não consulta o Keycloak por pedido para revalidar associações; um JWT
emitido anteriormente pode continuar a autorizar até à sua expiração.

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
permitidos a partir dos papéis e grupos capturados na emissão do bilhete.
Mensagens de texto do cliente não podem escolher outros tópicos e encerram
a ligação com código 1008.
Ligação sem bilhete válido é rejeitada; o mesmo bilhete não pode ser reutilizado.

O servidor verifica a expiração do JWT e a existência de âmbito operacional
em cada envio e a cada segundo. A identidade guardada na ligação é imutável:
a verificação usa os papéis/grupos do bilhete, sem voltar a consultar grupos
ou papéis no Keycloak. Remover um grupo ou papel não encerra imediatamente
uma ligação já aberta; apagar um grant legado também não a revoga. A ligação
termina na expiração do JWT ou quando os âmbitos capturados deixam de
corresponder a recursos operacionais. Após renovar o token, obter novo bilhete
e abrir nova ligação.

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
| `ACCESS_CHANGED` | Alteração de grant legado; administrador e utilizador afetado; não altera permissões efetivas |

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

A suite existente usa PostgreSQL, servidor HTTP real e clientes WebSocket
reais, mas ainda prepara acessos através de grants e não inclui grupos nos
JWT dos gestores. Também depende do `DataSeeder` atualmente comentado.
Os testes de concessão/revogação não validam o mecanismo atual até serem
adaptados; ver [README.md](README.md#testes). O script de validação Docker
mantém as mesmas suposições antigas, detalhadas em [DEMO.md](../DEMO.md#validação).
