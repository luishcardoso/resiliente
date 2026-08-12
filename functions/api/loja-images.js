// Pages Function to list images from R2 bucket "resiliente" folder "loja"
export async function onRequest(context) {
  const { env } = context;
  
  try {
    // List objects in the "loja/" prefix
    const listed = await env.R2_BUCKET.list({ prefix: "loja/" });
    
    // Filter for image files and build URLs
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif'];
    const images = listed.objects
      .filter(obj => {
        const key = obj.key.toLowerCase();
        return imageExtensions.some(ext => key.endsWith(ext));
      })
      .map(obj => ({
        key: obj.key,
        url: `https://pub-5e39d369540947e9b3c3f5a6a5dc72a5.r2.dev/${obj.key}`,
        name: obj.key.replace('loja/', ''),
        size: obj.size,
        uploaded: obj.uploaded
      }));
    
    return new Response(JSON.stringify({ images }), {
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300" // Cache for 5 minutes
      }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
