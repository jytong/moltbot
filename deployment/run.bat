
docker run -d --env-file .\deployment\.env --name moltbot-service -p 18789:18789 --restart always moltbot:local
