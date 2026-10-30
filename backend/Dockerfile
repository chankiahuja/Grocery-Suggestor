FROM node:24-bookworm-slim AS frontend
WORKDIR /workspace
RUN npm install --global pnpm@10.26.1
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build

FROM maven:3.9.9-eclipse-temurin-21 AS build
WORKDIR /workspace/backend
COPY backend/pom.xml .
COPY backend/src ./src
COPY --from=frontend /workspace/artifacts/grocery-app/dist/public /workspace/artifacts/grocery-app/dist/public
RUN mvn -B package -DskipTests
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /workspace/backend/target/pantrypal-api-0.1.0.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
