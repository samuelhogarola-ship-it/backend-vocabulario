import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

app.get("/api/vocabulario", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("vocabulario")
      .select("aleman, espanol, categoria, frase");

    if (error) {
      console.error("Error Supabase:", error);
      return res.status(500).json({ error: "Error al obtener vocabulario" });
    }

    const palabras = (data || []).map((item) => ({
      aleman: item.aleman || "",
      espanol: item.espanol || "",
      categoria: item.categoria || "Vocabulario",
      frase: item.frase || "",
    }));

    res.json({ palabras });
  } catch (error) {
    console.error("Error servidor:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
