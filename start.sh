docker stop hydrarouter
docker rm hydrarouter
docker build -t hydrarouter .
docker run -d --name hydrarouter -p 20128:20128 --env-file .env -v hydrarouter-data:/app/data hydrarouter