const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
    // Only allow POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { short_id } = req.body;

    // Supabase Credentials
    // Fallback directly to your live URL just in case Vercel ENV takes time to load
    const supabaseUrl = process.env.SUPABASE_URL || 'https://ktltanynwbdhmjwseqqm.supabase.co';
    const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

    if (!supabaseKey) {
         return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY missing in Vercel Environment Variables' });
    }

    // URL Cleanup (Safeguard in case '/rest/v1/' is accidentally added in ENV variables)
    const cleanUrl = supabaseUrl.trim().replace(/\/rest\/v1\/?$/, "").replace(/\/$/, "");

    try {
        // Initialize Supabase Client with the secure Service Key
        const supabase = createClient(cleanUrl, supabaseKey.trim());

        // 1. Fetch Link Data
        const { data: linkData, error: linkErr } = await supabase.from('links').select('*').eq('short_id', short_id).single();
        if (linkErr || !linkData) return res.status(404).json({ error: 'Link not found' });

        // 2. Fetch Admin Settings (For LIVE CPM)
        const { data: adminSettings } = await supabase.from('settings').select('*').limit(1).single();
        const cpm = adminSettings && adminSettings.cpm ? adminSettings.cpm : 2; // Default to $2 CPM if not set
        const earn_amount = cpm / 1000;

        // 3. Update LINK table (Increment views and earnings)
        await supabase.from('links').update({
            clicks: (linkData.clicks || 0) + 1,
            earnings: (linkData.earnings || 0) + earn_amount
        }).eq('id', linkData.id);

        // 4. Fetch and Update USER table (Adds money to the link owner)
        const { data: userData } = await supabase.from('users').select('*').eq('id', linkData.user_id).single();
        
        if (userData) {
            await supabase.from('users').update({
                balance: (userData.balance || 0) + earn_amount,
                today_earnings: (userData.today_earnings || 0) + earn_amount,
                total_earnings: (userData.total_earnings || 0) + earn_amount,
                total_clicks: (userData.total_clicks || 0) + 1,     // HOME PAGE VIEW FIX
                today_clicks: (userData.today_clicks || 0) + 1
            }).eq('id', userData.id);

            // 5. Referral Commission Logic
            const referPercent = adminSettings && adminSettings.refer_percent ? adminSettings.refer_percent : 10;
            
            if (referPercent > 0) {
                const { data: referralData } = await supabase.from('referrals').select('referrer_tg_id').eq('referred_tg_id', userData.telegram_id).single();
                
                if (referralData && referralData.referrer_tg_id) {
                    const { data: referrerData } = await supabase.from('users').select('*').eq('telegram_id', referralData.referrer_tg_id).single();
                    
                    if (referrerData) {
                        const referComm = earn_amount * (referPercent / 100);
                        await supabase.from('users').update({
                            balance: (referrerData.balance || 0) + referComm,
                            total_earnings: (referrerData.total_earnings || 0) + referComm
                        }).eq('id', referrerData.id);
                    }
                }
            }
        }

        return res.status(200).json({ success: true, message: 'Reward & Views added perfectly' });

    } catch (error) {
        console.error("Reward process error:", error);
        return res.status(500).json({ error: error.message });
    }
                }
