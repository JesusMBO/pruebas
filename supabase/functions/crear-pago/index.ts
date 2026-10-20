// Edge Function: crea una sesión de pago de Stripe para el usuario con sesión iniciada.
// Secretos necesarios en Supabase (Edge Functions → Secrets): STRIPE_SECRET_KEY
import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

// Producto "Premium" de Stripe. El precio se lee de Stripe (precio por defecto),
// así nadie puede cambiarlo desde el navegador.
const STRIPE_PRODUCT_ID = "prod_VTXK5eMghbtr4L";

// Webs desde las que se permite iniciar un pago: origen → dirección base de la web
// (en GitHub Pages la web vive dentro de la carpeta /pruebas/)
const SITES: Record<string, string> = {
  "http://localhost:5500": "http://localhost:5500/",
  "https://jesusmbo.github.io": "https://jesusmbo.github.io/pruebas/",
};
const ALLOWED_ORIGINS = Object.keys(SITES);

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function cors(origin: string | null) {
  return {
    "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(body: unknown, status: number, origin: string | null) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405, origin);
  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return json({ error: "Origen no permitido" }, 403, origin);

  // ¿Quién está pidiendo pagar? Verificamos su token de sesión con Supabase.
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return json({ error: "Debes iniciar sesión" }, 401, origin);

  try {
    // Si ya es premium, no le cobramos otra vez
    const { data: fila } = await supabase.from("premium").select("es_premium").eq("user_id", user.id).maybeSingle();
    if (fila?.es_premium) return json({ error: "Ya eres Premium" }, 409, origin);

    const product = await stripe.products.retrieve(STRIPE_PRODUCT_ID);
    const priceId = typeof product.default_price === "string" ? product.default_price : product.default_price?.id;
    if (!priceId) return json({ error: "El producto no tiene precio por defecto" }, 500, origin);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: priceId, quantity: 1 }],
      customer_email: user.email,
      client_reference_id: user.id, // así el webhook sabe a quién activar
      metadata: { user_id: user.id },
      success_url: `${SITES[origin]}pago-ok.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITES[origin]}privado.html?pago=cancelado`,
    });

    return json({ url: session.url }, 200, origin);
  } catch (e) {
    console.error(e);
    return json({ error: "No se pudo iniciar el pago" }, 500, origin);
  }
});
