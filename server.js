const express = require("express")
const axios = require("axios")
const cheerio = require("cheerio")
const cors = require("cors")
const cron = require("node-cron")

const app = express()
const PORT = Number(process.env.PORT) || 3000
const PRICE_URL = "https://www.noticiasagricolas.com.br/cotacoes/boi-gordo"

const priceCache = {
  value: null,
  fetchedForDate: null,
  lastUpdatedAt: null,
  lastError: null
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10)
}

function normalizeText(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function parsePriceFromText(text) {
  const normalized = normalizeText(text)
  const patterns = [
    /Boi Gordo - Media SP a prazo.*?(\d{2}\/\d{2}\/\d{4})\s+(\d{1,3}(?:\.\d{3})*,\d{2})\s+[+-]?\d+,\d{2}/i,
    /Boi Gordo - Media SP a prazo.*?Atualizado em:\s*(\d{2}\/\d{2}\/\d{4}).*?(\d{1,3}(?:\.\d{3})*,\d{2})/i
  ]

  for (const pattern of patterns) {
    const match = normalized.match(pattern)

    if (match) {
      return {
        date: match[1],
        price: Number(match[2].replace(/\./g, "").replace(",", "."))
      }
    }
  }

  return null
}

function parsePriceFromHtml(html) {
  const $ = cheerio.load(html)

  const headings = $("h1, h2, h3, h4, strong").toArray()

  for (const heading of headings) {
    const title = normalizeText($(heading).text())

    if (title.includes("Boi Gordo - Media SP a prazo")) {
      const block = normalizeText($(heading).parent().text())
      const match = block.match(/(\d{2}\/\d{2}\/\d{4}).*?(\d{1,3}(?:\.\d{3})*,\d{2})\s+[+-]?\d+,\d{2}/)

      if (match) {
        return {
          date: match[1],
          price: Number(match[2].replace(/\./g, "").replace(",", "."))
        }
      }
    }
  }

  return parsePriceFromText($("body").text())
}

async function fetchArrobaPrice() {
  const response = await axios.get(PRICE_URL, {
    timeout: 20000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
    }
  })

  const result = parsePriceFromHtml(response.data)

  if (!result || Number.isNaN(result.price)) {
    throw new Error("Nao foi possivel extrair o preco da arroba na fonte externa")
  }

  return {
    price: result.price,
    unit: "R$/@",
    source: "Cepea/Esalq via Noticias Agricolas",
    updated_at: result.date
  }
}

async function updateDailyPrice(force = false) {
  const todayKey = getTodayKey()

  if (!force && priceCache.value && priceCache.fetchedForDate === todayKey) {
    return priceCache.value
  }

  try {
    const latestPrice = await fetchArrobaPrice()

    priceCache.value = latestPrice
    priceCache.fetchedForDate = todayKey
    priceCache.lastUpdatedAt = new Date().toISOString()
    priceCache.lastError = null

    return latestPrice
  } catch (error) {
    priceCache.lastError = error.message

    if (priceCache.value) {
      return priceCache.value
    }

    throw error
  }
}

function startServer() {
  app.use(cors())

  app.get("/health", (req, res) => {
    res.json({ status: "ok" })
  })

  app.get("/arroba", async (req, res) => {
    try {
      const data = await updateDailyPrice()
      res.json({
        price: data.price,
        unit: data.unit,
        source: data.source
      })
    } catch (error) {
      res.status(503).json({
        error: "Unable to fetch arroba price",
        message: error.message
      })
    }
  })

  app.get("/arroba/today", async (req, res) => {
    try {
      const data = await updateDailyPrice()
      res.json({ price: data.price })
    } catch (error) {
      res.status(503).json({
        error: "Unable to fetch arroba price",
        message: error.message
      })
    }
  })

  cron.schedule("0 8 * * *", async () => {
    try {
      await updateDailyPrice(true)
      console.log("Preco da arroba atualizado automaticamente as 08:00")
    } catch (error) {
      console.error("Falha ao atualizar preco da arroba:", error.message)
    }
  })

  updateDailyPrice(true).catch((error) => {
    console.error("Falha ao carregar preco inicial da arroba:", error.message)
  })

  app.listen(PORT, () => {
    console.log("API Arroba iniciada")
    console.log(`API rodando na porta ${PORT}`)
    console.log(`http://localhost:${PORT}/arroba`)
  })
}

startServer()
