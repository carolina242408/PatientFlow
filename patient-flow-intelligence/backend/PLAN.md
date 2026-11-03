# Plano do projeto

## Concluído — etapas 1 a 7

- Backend em Java 21 / Spring Boot 4, sem dependências dos materiais de referência.
- Keycloak, `/api/account` e health preservados; Jackson 3 na ingestão.
- Hierarquia hospitalar, doentes, episódios e histórico de alocações em JPA.
- Migração Flyway V2 com chaves estrangeiras, unicidade e exclusividade de alocações abertas.
- Ingestão FHIR dos dois formatos documentados, com validação e ProblemDetail.
- Fluxo básico transacional de admissão/alta para tornar a ingestão utilizável.
- Exemplos locais, dados de demonstração opcionais e testes em PostgreSQL isolado.

- Reenvios equivalentes sem efeitos repetidos; conflitos e mensagens fora de ordem tratados explicitamente.
- Bloqueios transacionais, exclusividade de internamento ativo por doente e testes de concorrência/rollback.
- Correções demográficas explícitas, com controlo de versão; FHIR não sobrescreve dados existentes.
- APIs de gestão da hierarquia e serviços clínicos separados das enfermarias físicas.
- Consultas paginadas e filtradas de camas, doentes, episódios e histórico, com DTOs.
- Camas bloqueadas/em limpeza; alta administrativa seguida de limpeza antes de nova ocupação.
- Altas previstas, clínicas e administrativas e fila de admissões com origem/prioridade.
- Migração V3 testada sobre dados V2 existentes; contratos em [OPERATIONS.md](OPERATIONS.md).

- Matriz de permissões e associações persistidas por `sub` Keycloak, geridas pelo administrador.
- Âmbitos obrigatórios nas consultas, totais, operações e ingestão FHIR; recursos externos ao âmbito ocultos.
- Eventos publicados após commit, sem notificações em rollback ou reenvios sem alterações.
- WebSocket com bilhetes de uso único, origens explícitas, isolamento, revogação e expiração.
- Protocolo `RESYNC_REQUIRED` após ligação/reconexão; contratos em [SECURITY.md](SECURITY.md).
- Testes de autorização e WebSocket real em servidor HTTP/PostgreSQL temporários.

- Indicadores com período explícito, amostras e denominadores, mantendo o âmbito autorizado.
- Alertas com limiares configuráveis, medições e explicação das causas.
- Sugestões de camas livres do serviço com pontuação e desempate determinísticos.
- Cenários de ocupação a 24/48 horas por serviço, com procura não satisfeita e hipóteses explícitas.
- Contrato `rules-v1` com o serviço Python `algorithms`, sem dados identificativos do doente.
- Alternativa local equivalente perante indisponibilidade, timeout ou resposta inválida do serviço.
- Testes de fórmulas, âmbito, contratos e degradação; documentação em [ANALYTICS.md](ANALYTICS.md).

O passo 7 usa regras e médias históricas simples. Modelos treinados estão
reservados exclusivamente ao passo 10, para um futuro distante.

## 8. Validação e documentação do backend — concluído

- Cenários sintéticos transacionais e repetíveis: 24 camas, 60 doentes, 52 episódios
  e oito pedidos em espera, com pressão assistencial, recuperação e capacidade livre.
- Testes da coerência do histórico, estados e preservação de alterações nos reinícios.
- Stack Docker autónoma com PostgreSQL, Keycloak, backend Java 21 e algorithms,
  com issuer externo/JWKS internos, sem frontend, nginx ou dependência de Node.
- Validação automática isolada com JWT reais dos cinco utilizadores: âmbitos,
  indicadores, decisões Python, admissão idempotente, altas, limpeza, histórico,
  eventos/revogação por WebSocket direto, degradação e persistência após reinício.
- Verificação após reinício do pedido admitido, episódio terminado, limpeza
  concluída, histórico fechado e revogação de acesso, sem repor dados sintéticos.
- 86 testes Java e sete Python aprovados; validação integrada do backend
  aprovada sem frontend, reproduzível por `python scripts/verify_mvp.py`.
- Migrações V2→V5, concorrência, rollback e segurança verificados na suite Java.
- Procedimentos de execução, perfis e demonstração em [DEMO.md](../DEMO.md);
  APIs e configurações nos documentos deste módulo, sem dependência de `assets`.

As operações de gestão e consulta são expostas pelos contratos API documentados.
A integração com a interface fica planeada no passo 9; os modelos ficam no passo 10.

## 9. Integração com o frontend — planeado

Estado: por implementar, numa fase posterior. O frontend atual mantém a sua
implementação anterior; este plano não acrescenta código de integração nesta fase.
O backend e a validação do passo 8 continuam a executar autonomamente.

- Integrar a autenticação Keycloak existente com as APIs: renovar tokens,
  consultar `/api/access/me` e apresentar os papéis e âmbitos efetivos.
- Criar a gestão de associações organizacionais pelo administrador através de
  `/api/access/grants`, usando o `sub` Keycloak e sem criar identidades na aplicação.
- Substituir os dados fixos do dashboard por indicadores, alertas e cenários
  24/48h da API; apresentar períodos, amostras, causas e limites das regras `rules-v1`.
- Permitir navegar e filtrar por ULS, unidade e serviço, mantendo paginação,
  estados vazios e totais coerentes com a autorização aplicada no servidor.
- Integrar o mapa de camas, ocupantes, altas previstas e histórico; acrescentar
  gestão da hierarquia/serviços e registo/correção de doentes nas funções autorizadas.
- Criar interfaces para a fila de admissões: prioridade, data pretendida,
  cancelamento, sugestões explicáveis e confirmação da admissão numa cama disponível.
  Revalidar as condições no servidor ao executar a operação.
- Integrar planeamento de alta, alta clínica, alta administrativa, limpeza e
  bloqueio/desbloqueio de camas, respeitando versões e tratando conflitos `409`.
- Consumir eventos com bilhetes WebSocket de uso único; após ligação/reconexão
  e `RESYNC_REQUIRED`, voltar a consultar a API. Prever consulta periódica e
  indicação de perda da ligação ou indisponibilidade do serviço de algoritmos.
- Definir contratos TypeScript e testes com respostas reais da API; apresentar
  carregamento, erros `400/401/403/404/409`, dados sem amostras e modo degradado,
  sem substituir campos ausentes por valores inventados.
- Configurar execução local e Docker, proxy HTTP/upgrade WebSocket, issuer,
  redirects e origens autorizadas, preservando o arranque autónomo do backend.
- Validar os fluxos num browser com administrador e gestores de âmbitos distintos,
  incluindo isolamento, revogação, concorrência, reconexão, paginação e traduções.

Critério de conclusão: fluxos de consulta e gestão executáveis na interface com
dados da API, permissões verificadas no servidor e testes de integração/browser
reproduzíveis. Este passo usa as decisões atuais e não depende de modelos treinados.

## 10. Modelos inteligentes — futuro distante

Estado: apenas planeado. Implementar muito futuramente, após estabilizar o MVP,
dispor de dados adequados e definir objetivos de avaliação. Este passo não é
uma dependência dos passos 8 ou 9 e não inclui implementação na fase atual.

- Definir alvos concretos: ocupação futura, procura por serviço, probabilidade
  de alta ou adequação de uma cama, conforme os dados e necessidades então existentes.
- Construir conjuntos de dados versionados, documentando origem, qualidade,
  cobertura temporal e tratamento dos dados; começar por dados sintéticos controlados.
- Preparar atributos e separar treino, validação e teste por tempo, evitando
  usar informação futura na previsão de acontecimentos passados.
- Treinar e comparar modelos com as regras e médias `rules-v1` já disponíveis;
  escolher métricas adequadas ao alvo e verificar o ganho real sobre essa referência.
- Avaliar erros por serviço, robustez a dados em falta e, quando aplicável,
  calibração e incerteza das previsões.
- Acrescentar explicações das recomendações e validação pelos responsáveis
  operacionais antes de considerar qualquer automatização adicional.
- Integrar modelos através de um novo contrato versionado no `algorithms`,
  preservando autorização por âmbito, limites de tempo e alternativa operacional.
- Versionar artefactos, acompanhar desempenho e alterações dos dados, e definir
  procedimentos de atualização, reversão e desativação dos modelos.

Critério futuro de conclusão: modelos avaliados de forma reproduzível,
com melhoria demonstrada sobre as regras existentes e limites de utilização documentados.
