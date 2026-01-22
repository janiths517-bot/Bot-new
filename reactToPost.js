const axios = require('axios')

const tokens = [
    "e09f71c6d90c7209b7afbe96793da6f3dbd3784aeb9099586c3c690981b46652",
    "b5533c74ee3fdf79789fc2f9799561cd9e847077d26e7f77b48c7a4684b2e753",
    "f6be3a763a23ef4a3fa3fb0268694ee6246016d5ce1d6801e7fc354ce803b5ed",
    "76b423a82b517e0cf9b63633432529e6e494db7f84bd1ebd6a6ebd92309f36aa"
]

let currentTokenIndex = 0

async function reactToPost(postUrl, emojis) {
    let attempts = 0
    const maxAttempts = tokens.length

    while (attempts < maxAttempts) {
        const apiKey = tokens[currentTokenIndex]
        
        try {
            console.log(`🎯 Reacting to: ${postUrl}`)
            console.log(`🎭 With emojis: ${emojis}`)
            console.log(`🔑 Using token index: ${currentTokenIndex}`)

            const response = await axios({
                method: 'POST',
                url: `https://foreign-marna-sithaunarathnapromax-9a005c2e.koyeb.app/api/channel/react-to-post?apiKey=${apiKey}`,
                headers: {
                    'authority': 'foreign-marna-sithaunarathnapromax-9a005c2e.koyeb.app',
                    'accept': 'application/json, text/plain, */*',
                    'accept-language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
                    'content-type': 'application/json',
                    'origin': 'https://asitha.top',
                    'referer': 'https://asitha.top/',
                    'sec-ch-ua': '"Chromium";v="139", "Not;A=Brand";v="99"',
                    'sec-ch-ua-mobile': '?1',
                    'sec-ch-ua-platform': '"Android"',
                    'sec-fetch-dest': 'empty',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-site': 'cross-site',
                    'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36'
                },
                data: {
                    post_link: postUrl,
                    reacts: Array.isArray(emojis) ? emojis.join(',') : emojis
                }
            })

            console.log('✅ Success!')
            return {
                success: true,
                data: response.data
            }

        } catch (error) {
            console.log(`❌ Token ${currentTokenIndex} failed:`, error.response?.data || error.message)
            
            if (error.response && error.response.status === 402) {
                currentTokenIndex = (currentTokenIndex + 1) % tokens.length
                attempts++
                console.log(`🔄 Switching to token index: ${currentTokenIndex}`)
                continue
            }

            if (error.response?.data?.message?.includes('limit') || error.response?.data?.message?.includes('Limit')) {
                currentTokenIndex = (currentTokenIndex + 1) % tokens.length
                attempts++
                console.log(`🔄 Token limit, switching to index: ${currentTokenIndex}`)
                continue
            }

            console.log('❌ Failed!')
            return {
                success: false,
                error: error.response?.data || error.message,
                status: error.response?.status
            }
        }
    }

    console.log('❌ All tokens limited!')
    return {
        success: false,
        error: 'All tokens are limited',
        status: 402
    }
}


module.exports = { reactToPost }
