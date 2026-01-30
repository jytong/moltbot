#!/usr/bin/env bash

container_name="moltbot-service"

docker stop $container_name

docker rm -f $container_name

docker run -d \
 --env-file deployment/.env \
 --name $container_name \
 -p 18789:18789 \
 --restart always \
 moltbot:local
