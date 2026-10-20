// Edge Function: recibe los avisos (webhooks) de Stripe y activa Premium.
// Secretos necesarios en Supabase: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// Debe desplegarse SIN verificación JWT (Stripe no envía token de Supabase);
// la seguridad la da la firma de Stripe, que se comprueba abajo.
import Stripe from "npm:stripe@17.7.0";
import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!);
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const cryptoProvider = Stripe.createSubtleCryptoProvider();

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req) => {
  const signature = req.headers.get("Stripe-Signature");
  const body = await req.text();

  // Comprobar que el aviso viene de verdad de Stripe
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature!, webhookSecret, undefined, cryptoProvider);
  } catch (e) {
    console.error("Firma no válida:", (e as Error).message);
    return new Response("Firma no válida", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    const userId = session.client_reference_id;

    if (userId && session.payment_status === "paid") {
      const { error } = await supabase.from("premium").upsert({
        user_id: userId,
        es_premium: true,
        stripe_session_id: session.id,
        pagado_en: new Date().toISOString(),
      });
      if (error) {
        console.error("Error guardando premium:", error);
        // 500 → Stripe reintentará el aviso más tarde
        return new Response("Error interno", { status: 500 });
      }
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
