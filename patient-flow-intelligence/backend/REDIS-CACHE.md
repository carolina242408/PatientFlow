# Cache Redis

O backend usa Redis como cache distribuída de respostas agregadas e da estrutura
organizacional do hospital. A cache reduz consultas repetidas ao PostgreSQL, mas
não é a fonte de verdade: se Redis estiver indisponível, a API continua a
consultar a base de dados.

## O que é guardado

| Dados | Endpoints | Conteúdo guardado |
| --- | --- | --- |
| Ocupação agregada | `GET /api/analytics/occupancy` | Totais e percentagens por serviço, unidade e ULS, dentro do âmbito pedido |
| Estrutura hospitalar | `GET /api/hierarchy/{type}` e `GET /api/hierarchy/{type}/{id}` | Nós da hierarquia, como ULS, hospitais, edifícios, pisos, serviços, alas, enfermarias, quartos e camas |

Não são guardados dados demográficos, identificadores SNS, nomes de doentes,
episódios ou tokens de acesso. Sugestões de camas, disponibilidade operacional
e outras respostas de fluxo clínico não são servidas a partir desta cache.

## Isolamento e validade

Cada entrada de ocupação usa uma chave que inclui todos os campos do âmbito e o
limiar de ocupação crítica. Assim, resultados de âmbitos diferentes não
partilham a mesma entrada.

As chaves da hierarquia incluem o tipo de nó, o identificador do pai, a
paginação (quando aplicável) e um resumo SHA-256 da identidade autenticada, dos
papéis e dos âmbitos do claim `groups` do JWT. O backend valida a autorização do
pedido antes de consultar a cache. Em caso de falta, a consulta ao repositório
aplica também o filtro de âmbito no PostgreSQL.

Todas as entradas têm um TTL curto, de cinco segundos por omissão. Criar,
renomear ou eliminar um elemento da hierarquia incrementa a versão da cache da
hierarquia. As entradas da versão anterior deixam de ser usadas e expiram pelo
TTL. Alterações à hierarquia feitas fora desses endpoints ficam sujeitas ao
mesmo TTL máximo.

## Falhas do Redis

Uma entrada ausente ou ilegível é tratada como falta de cache. Se uma operação
Redis falhar, o backend carrega a resposta do PostgreSQL e tenta continuar a
responder normalmente. A falha do Redis não bloqueia a consulta nem altera a
fonte de verdade.

## Configuração e execução

O serviço `redis` já está definido no `docker-compose.yml`. No desenvolvimento
com o backend executado no host, iniciar Redis juntamente com as restantes
dependências:

```bash
docker compose up -d postgresql keycloak algorithms redis
```

Executando o backend em Docker Compose, o host Redis é `redis`. Executando no
host, o valor por omissão é `localhost`.

| Variável | Valor por omissão | Descrição |
| --- | --- | --- |
| `REDIS_HOST` | `localhost` | Host Redis; no Compose, definido como `redis` |
| `REDIS_PORT` | `6379` | Porta Redis |
| `ANALYTICS_CACHE_TTL` | `5s` | TTL de todas as entradas desta cache |

Para verificar as chaves existentes no Redis do Compose:

```bash
docker compose exec redis redis-cli --scan --pattern 'patientflow:*'
```

Os valores são JSON. As chaves de hierarquia contêm um resumo da identidade em
vez do subject ou dos âmbitos em claro.

## Implementação

`RedisResponseCache` encapsula leitura, serialização JSON, TTL e fallback para a
base de dados. `AnalyticsService` usa-a para ocupação; `HierarchyService` usa-a
para listas e detalhes da hierarquia e invalida a versão após alterações. A
integração usa `StringRedisTemplate` e o `JsonMapper` já configurado no backend.