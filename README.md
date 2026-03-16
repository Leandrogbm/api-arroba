# api-arroba

Microservico Node.js para expor o preco da arroba do boi via API.

## Estrutura

```text
api-arroba
|- server.js
|- package.json
`- package-lock.json
```

## Executar localmente

```bash
npm install
npm start
```

API:

```text
http://localhost:3000/arroba
```

## Endpoints

### `GET /arroba`

Retorna o ultimo valor disponivel no formato:

```json
{
  "price": 305.40,
  "unit": "R$/@",
  "source": "CEPEA"
}
```

### `GET /arroba/today`

```json
{
  "price": 305.40
}
```

### `GET /health`

```json
{
  "status": "ok"
}
```

## Deploy no Render

Use estas configuracoes:

- Build Command: `npm install`
- Start Command: `npm start`

Depois do deploy, a API ficara acessivel em uma URL como:

```text
https://api-arroba.onrender.com/arroba
```
