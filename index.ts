import index from "./index.html";

Bun.serve({
  routes: {
    "/": index,

    "/models/*": async (req) => {
      const url = new URL(req.url);
      const file = Bun.file(`./public${url.pathname}`);
      if (await file.exists()) {
        return new Response(file);
      }
      return new Response("Not found", { status: 404 });
    },

    /**
     * Proxy satellite tile requests to Google Maps Static API.
     * Keeps the API key server-side and avoids CORS issues.
     */
    "/api/satellite": async (req) => {
      const apiKey = process.env.GOOGLE_MAPS_API_KEY;
      if (!apiKey) {
        return new Response(
          JSON.stringify({
            error:
              "GOOGLE_MAPS_API_KEY not configured. Set it in your env.",
          }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      const url = new URL(req.url);
      const mapsUrl = new URL(
        "https://maps.googleapis.com/maps/api/staticmap"
      );

      for (const param of ["center", "zoom", "size", "maptype", "scale"]) {
        const val = url.searchParams.get(param);
        if (val) mapsUrl.searchParams.set(param, val);
      }
      mapsUrl.searchParams.set("key", apiKey);

      try {
        const res = await fetch(mapsUrl.toString());
        if (!res.ok) {
          return new Response(
            `Google Maps API error: ${res.status} ${res.statusText}`,
            { status: res.status }
          );
        }

        return new Response(await res.arrayBuffer(), {
          headers: {
            "Content-Type": res.headers.get("Content-Type") ?? "image/png",
            "Cache-Control": "public, max-age=86400",
          },
        });
      } catch (err: any) {
        return new Response(`Satellite proxy error: ${err.message}`, {
          status: 502,
        });
      }
    },
  },
  development: {
    hmr: true,
    console: true,
  },
});

console.log("[OpenDisaster] Server running at http://localhost:3000");
