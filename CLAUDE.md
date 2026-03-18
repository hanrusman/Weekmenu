# Weekmenu - Project Notes

## Docker Compose Service Template

Wanneer er een nieuwe service toegevoegd moet worden aan de docker-compose.yml van de infra repo, gebruik dan deze stijl. Het volgende nummer is **14**.

```yaml
  # --- {NUMMER}. {NAAM_UPPERCASE} ---
  {naam_lowercase}:
    build: https://github.com/hanrusman/{Repo}.git#main
    container_name: {naam_lowercase}
    restart: unless-stopped
    read_only: true
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    user: "1000:1000"
    tmpfs:
      - /tmp:rw,noexec,nosuid
    volumes:
      - ./{naam_lowercase}/data:/app/data:rw
    env_file:
      - ./{naam_lowercase}/.env
    environment:
      - TZ=Europe/Amsterdam
      - NODE_ENV=production
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://localhost:{PORT}/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
      interval: 5m
      timeout: 10s
      retries: 3
      start_period: 30s
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: '0.5'
          pids: 100
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
    networks:
      - personal_net
      - traefik
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.{naam_lowercase}.rule=Host(`{naam_lowercase}.c4w.nl`)"
      - "traefik.http.routers.{naam_lowercase}.entrypoints=websecure"
      - "traefik.http.routers.{naam_lowercase}.tls.certresolver=letsencrypt"
      - "traefik.http.services.{naam_lowercase}.loadbalancer.server.port={PORT}"
```

### Stijlregels
- Nummering: oplopend (volgende is 14)
- Comment header: `# --- {NR}. {NAAM} ---`
- Altijd: `read_only: true`, `no-new-privileges`, `cap_drop: ALL`, `user: "1000:1000"`
- Altijd: tmpfs voor /tmp, json-file logging met max 10m/3 files
- Netwerken: `personal_net` + `traefik`
- Traefik labels met subdomain op `c4w.nl`
- Resource limits: 256M memory, 0.5 CPU, 100 pids
- Timezone: Europe/Amsterdam
