# Plano do projeto

## Modelos inteligentes — futuro distante

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
