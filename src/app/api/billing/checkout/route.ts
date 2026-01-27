import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

type CheckoutMode = 'payment' | 'subscription'

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: auth } = await supabase.auth.getUser()
  const user = auth.user
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await request.json().catch(() => ({}))) as { mode?: CheckoutMode }
  const mode = body.mode
  if (!mode || (mode !== 'payment' && mode !== 'subscription')) {
    return NextResponse.json({ error: 'Invalid mode' }, { status: 400 })
  }

  const priceId =
    mode === 'payment'
      ? process.env.STRIPE_PRICE_ONE_TIME
      : process.env.STRIPE_PRICE_SUBSCRIPTION

  if (!priceId) {
    return NextResponse.json({ error: 'Missing Stripe price ID' }, { status: 500 })
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY
  if (!stripeSecret) {
    return NextResponse.json({ error: 'Missing STRIPE_SECRET_KEY' }, { status: 500 })
  }

  const service = createServiceClient()
  const { data: profile } = await service
    .from('profiles')
    .select('email')
    .eq('user_id', user.id)
    .maybeSingle()

  const Stripe = (await import('stripe')).default
  const stripe = new Stripe(stripeSecret, { apiVersion: '2023-10-16' })
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://cwf.lol'
  const successUrl = `${siteUrl}/dashboard?section=billing&billing_ok=${encodeURIComponent('Purchase completed')}`
  const cancelUrl = `${siteUrl}/dashboard?section=billing&billing_err=${encodeURIComponent('Checkout canceled')}`

  const session = await stripe.checkout.sessions.create({
    mode,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: profile?.email ?? undefined,
    metadata: {
      user_id: user.id,
      type: mode === 'payment' ? 'leaderboard_slot_one_time' : 'leaderboard_slot_subscription',
    },
  })

  if (!session.url) {
    return NextResponse.json({ error: 'Unable to start checkout' }, { status: 500 })
  }

  return NextResponse.json({ url: session.url })
}
