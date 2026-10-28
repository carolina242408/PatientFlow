"""Portuguese reference data used to build realistic synthetic identities.

Names are stored in upper case, as most Portuguese hospital information
systems (SONHO, SClínico, ...) store them. Accented characters are kept here
and escaped later by the HL7 builder (``\\XHH\\``) so that the consumer's
decoder is exercised.
"""

from __future__ import annotations

MALE_GIVEN = [
    "JOÃO", "JOSÉ", "ANTÓNIO", "MANUEL", "FRANCISCO", "LUÍS", "CARLOS", "PEDRO",
    "PAULO", "RUI", "JORGE", "MIGUEL", "NUNO", "RICARDO", "TIAGO", "BRUNO",
    "ANDRÉ", "DIOGO", "RODRIGO", "DUARTE", "AFONSO", "TOMÁS", "GONÇALO", "MARTIM",
    "FERNANDO", "ARMANDO", "JOAQUIM", "ALBERTO", "ABEL", "ADELINO", "AMÉRICO",
    "ARTUR", "AUGUSTO", "BERNARDO", "CÉSAR", "DOMINGOS", "EDUARDO", "FILIPE",
    "HENRIQUE", "HUGO", "JAIME", "LEONEL", "MÁRIO", "MARCO", "SÉRGIO", "VASCO",
    "VÍTOR", "ÁLVARO", "ÂNGELO", "CRISTIANO", "DANIEL", "GUILHERME", "SIMÃO",
]

FEMALE_GIVEN = [
    "MARIA", "ANA", "JOANA", "BEATRIZ", "MARIANA", "INÊS", "CAROLINA", "SOFIA",
    "MARGARIDA", "LEONOR", "MATILDE", "RITA", "CATARINA", "SARA", "PATRÍCIA",
    "SÓNIA", "CLÁUDIA", "SUSANA", "TERESA", "ISABEL", "FERNANDA", "ROSA",
    "CONCEIÇÃO", "FÁTIMA", "GRAÇA", "LURDES", "EMÍLIA", "ALICE", "AMÉLIA",
    "ARMINDA", "AURORA", "CÂNDIDA", "CELESTE", "DEOLINDA", "ELISA", "GLÓRIA",
    "HELENA", "IRENE", "JÚLIA", "LAURA", "LÚCIA", "MADALENA", "NATÁLIA",
    "OLÍVIA", "PAULA", "RAQUEL", "ROSÁRIO", "SANDRA", "VERA", "DIANA", "LARA",
]

# Surnames, roughly ordered by frequency in Portugal (weights decay).
SURNAMES = [
    "SILVA", "SANTOS", "FERREIRA", "PEREIRA", "OLIVEIRA", "COSTA", "RODRIGUES",
    "MARTINS", "JESUS", "SOUSA", "FERNANDES", "GONÇALVES", "GOMES", "LOPES",
    "MARQUES", "ALVES", "ALMEIDA", "RIBEIRO", "PINTO", "CARVALHO", "TEIXEIRA",
    "MOREIRA", "CORREIA", "MENDES", "NUNES", "SOARES", "VIEIRA", "MONTEIRO",
    "CARDOSO", "ROCHA", "RAPOSO", "NEVES", "COELHO", "CRUZ", "CUNHA", "PIRES",
    "RAMOS", "REIS", "SIMÕES", "ANTUNES", "MATOS", "FONSECA", "MACHADO",
    "ARAÚJO", "BARBOSA", "TAVARES", "LOURENÇO", "CASTRO", "FIGUEIREDO",
    "AZEVEDO", "FREITAS", "MAGALHÃES", "BRAGA", "VAZ", "AMARAL", "FARIA",
    "MIRANDA", "BARROS", "ESTEVES", "CAMPOS", "GUERREIRO", "HENRIQUES",
    "BAPTISTA", "SÁ", "QUEIRÓS", "ABREU", "MACEDO", "SALGADO", "VILAÇA",
    "PEIXOTO", "GUIMARÃES", "DIAS", "MOURA", "LEITE", "CORDEIRO", "BRANCO",
]

# Portuguese naming particles that may precede a surname.
SURNAME_PARTICLES = ["DA", "DE", "DOS", "DAS"]

STREET_TYPES = ["RUA", "RUA", "RUA", "AVENIDA", "TRAVESSA", "LARGO", "BECO", "ALAMEDA", "PRACETA"]

STREET_NAMES = [
    "DE SANTA MARGARIDA", "DA LIBERDADE", "DOM PEDRO V", "DO CARMO", "DA SÉ",
    "DE SÃO VICENTE", "25 DE ABRIL", "CENTRAL", "DA IGREJA", "DO SOUTO",
    "DR. FRANCISCO PIRES GONÇALVES", "DA BOAVISTA", "DE CAMÕES", "DO OUTEIRO",
    "DA ESTAÇÃO", "DO MOSTEIRO", "NOVA", "DA FONTE", "DAS FLORES", "DO CRUZEIRO",
    "DE SANTO ANTÓNIO", "DO PAÇO", "DA REPÚBLICA", "CONDE DE AGROLONGO",
    "DOS COMBATENTES", "DA RESTAURAÇÃO", "DE GUIMARÃES", "DO RAIO", "DA QUINTÃ",
]

FLOOR_SUFFIXES = ["", "", "", "R/C", "1º ESQ", "1º DTO", "2º ESQ", "2º DTO", "3º FRT", "4º ESQ"]

# Catchment area (Minho). Each concelho has: district, DICOFRE code (4 digits),
# postal code prefix range, localities and a relative population weight.
CONCELHOS = [
    {"name": "BRAGA", "district": "BRAGA", "dicofre": "0303", "cp": (4700, 4719),
     "localities": ["BRAGA", "MAXIMINOS", "SÃO VICENTE", "NOGUEIRÓ", "LAMAÇÃES", "REAL", "GUALTAR", "TADIM"], "weight": 30},
    {"name": "GUIMARÃES", "district": "BRAGA", "dicofre": "0308", "cp": (4800, 4839),
     "localities": ["GUIMARÃES", "AZURÉM", "CALDAS DAS TAIPAS", "PEVIDÉM", "MOREIRA DE CÓNEGOS", "PONTE"], "weight": 22},
    {"name": "VILA NOVA DE FAMALICÃO", "district": "BRAGA", "dicofre": "0312", "cp": (4760, 4775),
     "localities": ["VILA NOVA DE FAMALICÃO", "JOANE", "RIBA DE AVE", "RIBEIRÃO", "BRUFE"], "weight": 18},
    {"name": "BARCELOS", "district": "BRAGA", "dicofre": "0302", "cp": (4750, 4755),
     "localities": ["BARCELOS", "BARCELINHOS", "ARCOZELO", "VILA FRESCAINHA", "MANHENTE"], "weight": 16},
    {"name": "VILA VERDE", "district": "BRAGA", "dicofre": "0313", "cp": (4730, 4730),
     "localities": ["VILA VERDE", "PRADO", "MOURE", "PICO DE REGALADOS"], "weight": 6},
    {"name": "AMARES", "district": "BRAGA", "dicofre": "0301", "cp": (4720, 4720),
     "localities": ["AMARES", "FERREIROS", "CAIRES"], "weight": 3},
    {"name": "PÓVOA DE LANHOSO", "district": "BRAGA", "dicofre": "0309", "cp": (4830, 4830),
     "localities": ["PÓVOA DE LANHOSO", "FONTE ARCADA", "GARFE"], "weight": 3},
    {"name": "ESPOSENDE", "district": "BRAGA", "dicofre": "0306", "cp": (4740, 4740),
     "localities": ["ESPOSENDE", "APÚLIA", "FÃO", "MARINHAS"], "weight": 5},
    {"name": "FAFE", "district": "BRAGA", "dicofre": "0307", "cp": (4820, 4824),
     "localities": ["FAFE", "ARÕES", "QUINCHÃES"], "weight": 6},
    {"name": "TERRAS DE BOURO", "district": "BRAGA", "dicofre": "0310", "cp": (4840, 4840),
     "localities": ["TERRAS DE BOURO", "RIO CALDO", "GERÊS"], "weight": 1},
    {"name": "VIANA DO CASTELO", "district": "VIANA DO CASTELO", "dicofre": "1609", "cp": (4900, 4935),
     "localities": ["VIANA DO CASTELO", "DARQUE", "MEADELA", "AREOSA"], "weight": 3},
    {"name": "PORTO", "district": "PORTO", "dicofre": "1312", "cp": (4000, 4369),
     "localities": ["PORTO", "PARANHOS", "CAMPANHÃ", "RAMALDE"], "weight": 2},
]

EMAIL_DOMAINS = ["gmail.com", "gmail.com", "hotmail.com", "sapo.pt", "outlook.pt", "live.com.pt", "iol.pt"]

# Marital status texts sent in PID-16 (the converter maps these Portuguese
# values to the HL7 v3 MaritalStatus code system).
MARITAL = {
    "S": {"M": "SOLTEIRO", "F": "SOLTEIRA"},
    "M": {"M": "CASADO", "F": "CASADA"},
    "D": {"M": "DIVORCIADO", "F": "DIVORCIADA"},
    "W": {"M": "VIUVO", "F": "VIUVA"},
    "L": {"M": "SEPARADO", "F": "SEPARADA"},
}
