docker stop HydraROUTER
docker rm HydraROUTER
docker build -t HydraROUTER .
docker run -d --name HydraROUTER -p 20128:20128 --env-file .env -v HydraROUTER-data:/app/data HydraROUTER