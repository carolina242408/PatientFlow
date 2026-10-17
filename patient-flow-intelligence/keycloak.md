As Roles do keycloak são criadas automaticamente no [realm-config/jhipster-realm.json](./src/main/docker/realm-config/jhipster-realm.json#L48), estas roles são guardadas numa tabela numa bd própria do KC que também é criada ao iniciar o projeto [postgres-init/01-create-keycloak-db.sql](/src/main/docker/postgres-init/01-create-keycloak-db.sql).

