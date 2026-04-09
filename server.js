import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const missingEnv = [];

if (!supabaseUrl) missingEnv.push("SUPABASE_URL");
if (!supabaseKey) missingEnv.push("SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY");

const supabase = missingEnv.length === 0
  ? createClient(supabaseUrl, supabaseKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

function getConfigError() {
  if (missingEnv.length === 0) return null;
  return `Faltan variables de entorno: ${missingEnv.join(", ")}`;
}

app.get("/api/health", (req, res) => {
  const configError = getConfigError();

  res.status(configError ? 500 : 200).json({
    ok: !configError,
    supabaseConfigured: !configError,
    usingServiceRoleKey: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    error: configError
  });
});

app.get("/api/vocabulario", async (req, res) => {
  try {
    const configError = getConfigError();
    if (configError) {
      return res.status(500).json({ error: configError });
    }

    const { data, error } = await supabase
      .from("vocabulario")
      .select("id,german,word_type,spanish,example_sentence_de,level,article");

    if (error) {
      console.error("Error Supabase:", error);
      return res.status(500).json({
        error: "Error al obtener vocabulario",
        details: error.message
      });
    }

    const palabras = (data || []).map((item) => ({
      aleman: [item.article, item.german].filter(Boolean).join(" ").trim(),
      espanol: item.spanish || "",
      categoria: item.word_type || "Vocabulario",
      frase: item.example_sentence_de || "",
      nivel: item.level || ""
    }));

    res.json({ palabras });
  } catch (error) {
    console.error("Error servidor:", error);
    res.status(500).json({ error: "Error interno" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const configError = getConfigError();
  if (configError) {
    console.warn(`[config] ${configError}`);
  }
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
