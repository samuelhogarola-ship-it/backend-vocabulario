import express from "express";
import cors from "cors";
import { Client } from "@notionhq/client";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const notion = new Client({
  auth: process.env.NOTION_API_KEY,
});

const DATABASE_ID = process.env.NOTION_DB_ID;

app.get("/api/vocabulario", async (req, res) => {
  try {
    const response = await notion.databases.query({
      database_id: DATABASE_ID,
    });

    const palabras = response.results.map(page => {
      return {
        aleman: page.properties.Aleman?.title?.[0]?.plain_text || "",
        espanol: page.properties.Espanol?.rich_text?.[0]?.plain_text || "",
        categoria: page.properties.Categoria?.select?.name || "Vocabulario"
      };
    });

    res.json({ palabras });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error leyendo Notion" });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Servidor en puerto ${PORT}`);
});