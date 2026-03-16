const express = require("express")
const axios = require("axios")
const cheerio = require("cheerio")
const cors = require("cors")
const cron = require("node-cron")

const app = express()
const PORT = Number(process.env.PORT) || 3000
const CEPEA_URL = "https://cepea.org.br/br/indicador/boi-gordo.aspx"

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
    /Boi Gordo - Media a Prazo Estado de Sao Paulo.*?R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i,
    /Indicador do boi gordo CEPEA\/ESALQ.*?R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i,
    /Estado de Sao Paulo.*?(\d{1,3}(?:\.\d{3})*,\d{2})/i
  ]

  for (const pattern of patterns) {
    const match = normalized.match(pattern)

    if (match) {
      return Number(match[1].replace(/\./g, "").replace(",", "."))
    }
  }

  return null
}

function parsePriceFromHtml(html) {
  const $ = cheerio.load(html)

  const rows = $("tr").toArray()

  for (const row of rows) {
    const rowText = normalizeText($(row).text())

    if (
      rowText.includes("Boi Gordo - Media a Prazo Estado de Sao Paulo") ||
      rowText.includes("Indicador do boi gordo CEPEA/ESALQ")
    ) {
      const priceMatch = rowText.match(/(\d{1,3}(?:\.\d{3})*,\d{2})/)

      if (priceMatch) {
        return Number(priceMatch[1].replace(/\./g, "").replace(",", "."))
      }
    }
  }

  return parsePriceFromText($("body").text())
}

async function fetchArrobaPrice() {
  const response = await axios.get(CEPEA_URL, {
    timeout: 20000,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      Referer: "https://cepea.org.br/"
    }
  })

  const price = parsePriceFromHtml(response.data)

  if (price === null || Number.isNaN(price)) {
    throw new Error("Nao foi possivel extrair o preco da arroba no site do CEPEA")
  }

  return {
    price,
    unit: "R$/@",
    source: "CEPEA",
    updated_at: getTodayKey()
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
