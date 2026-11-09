# Dataset sintético para Length of Stay

Gerador independente do serviço FastAPI, baseado em
`tools/data-generation/pfgen/{synthea,simulation}.py` e nos parâmetros de
`tools/data-generation/config/{hospital,simulation}.yaml`.
Utiliza apenas a biblioteca padrão de Python 3.10+; não requer novas dependências.

O Synthea fornece a população e a demografia através de `patients.csv`.
O gerador cria os diagnósticos, admissões e altas, sem utilizar diagnósticos,
encounters ou outros dados clínicos do Synthea. A exportação do Synthea está
limitada a `patients.csv`, com FHIR e os restantes formatos desativados.
Isto limita os dados exportados e consumidos; o Synthea continua a executar
o seu motor interno de simulação da população.

O CSV final contém **exatamente 1000 linhas de dados**, além deste cabeçalho,
com cinco colunas nesta ordem e codificação UTF-8:

```csv
Idade,Sexo,Diagnóstico,DataAdmissão,DuraçãoInternamento(target)
```

| Coluna | Conteúdo |
| --- | --- |
| Idade | Idade em anos completos na admissão, calculada a partir de BIRTHDATE. |
| Sexo | GENDER original do Synthea: `M` ou `F`. |
| Diagnóstico | Código ICD-10 do diagnóstico principal atribuído na admissão. |
| DataAdmissão | Data e hora local, no formato `YYYY-MM-DDTHH:MM:SS`. |
| DuraçãoInternamento(target) | Dias inteiros de 24 horas entre admissão e alta, entre 1 e 90. |

Cada episódio pertence a um paciente distinto. O identificador Synthea e a alta
mantêm-se associados ao episódio em memória, mas não são exportados para evitar
colunas adicionais. O target é calculado pela diferença entre alta e admissão.

## Utilização

A partir da raiz do repositório, no PowerShell, para executar posteriormente:

```powershell
py -3 patient-flow-intelligence/algorithms/datasetgenerator/main.py --synthea-jar "C:/caminho/synthea-with-dependencies.jar"
```

Utilize o JDK 21 do projeto, disponível no `PATH`, e um JAR obtido nas
[releases oficiais do Synthea](https://github.com/synthetichealth/synthea/releases).
Se o JAR já estiver na cache de `tools/data-generation/.cache/synthea/`, o
argumento `--synthea-jar` pode ser omitido. Não há download automático.
Os parâmetros de exportação seguem a
[configuração oficial do Synthea](https://github.com/synthetichealth/synthea/blob/master/src/main/resources/synthea.properties).

Também é possível reutilizar um `patients.csv` já produzido pelo Synthea, sem
invocar Java nem gerar outra população:

```powershell
py -3 patient-flow-intelligence/algorithms/datasetgenerator/main.py --patients-csv "C:/caminho/patients.csv"
```

São necessários pelo menos 1000 pacientes distintos, vivos e com 18–100 anos na
data inicial. CSVs incompletos, datas inválidas, sexo fora de `M`/`F` e IDs
duplicados produzem um erro explícito. Se a população for insuficiente ou o
Synthea falhar, a execução termina sem substituir a demografia por dados próprios.

Por omissão, o resultado fica em `datasetgenerator/output/los_dataset.csv`.
As execuções do Synthea ficam em pastas distintas dentro de
`datasetgenerator/.cache/synthea/`, preservando `csv/patients.csv` e `synthea.log`.
Um CSV final existente só é substituído depois da escrita completa do novo dataset.

Opções adicionais: `--output`, `--work-dir`, `--start YYYY-MM-DD`, `--days`,
`--seed` e `--state`. A quantidade de linhas é fixa em 1000.
Os valores iniciais herdados do gerador existente são `2026-10-01`, um período
de admissões de 7 dias, seed `42` e estado `Massachusetts`.
As altas podem ocorrer depois do período de admissões: todos os episódios têm
alta e target conhecidos, sem truncar internamentos no fim desse período.

## Modelo de simulação

Os perfis de Medicina Interna, Cirurgia Geral, Ortopedia, Cardiologia,
Pneumologia e Neurologia são uma cópia explícita dos parâmetros existentes,
incluindo capacidades, ocupação, idade, duração e diagnósticos de fallback.
A UCI não é incluída porque a duração configurada nesse serviço representa
apenas a passagem pelos cuidados intensivos, não o internamento hospitalar total.

Para cada paciente selecionado, sorteia-se um dia dentro do período indicado.
A especialidade é ponderada pelo perfil etário e pela taxa de admissões
`capacidade × ocupação / duração média`, usando as fórmulas do gerador original.
O diagnóstico é escolhido do catálogo dessa especialidade. As admissões
programadas usam a fração configurada e o horário das 08h–11h, em dias úteis;
as restantes usam o perfil horário urgente existente.

A duração segue a distribuição lognormal original por especialidade, com
o fator `0.8` para admissões programadas. É arredondada ao inteiro mais próximo
(`round` do Python, empates para o par) e limitada a 1–90 dias. A alta é criada
como `admissão + duração`, garantindo dias inteiros exatos. Esta versão não
simula camas, transferências, readmissões, mortalidade nem adiamentos de alta.

A mesma entrada, período e seed reproduzem o CSV. Ao executar o Synthea,
conserve também a mesma versão do JAR; o motor usa uma thread e datas explícitas.
O ficheiro é ordenado por data de admissão, permitindo uma divisão temporal
posterior entre treino e validação. Não são criados splits nem treinados modelos.

Os targets resultam destas regras sintéticas. A validação de um modelo neste
dataset mede a aprendizagem da simulação; não demonstra desempenho clínico
com dados hospitalares reais.
