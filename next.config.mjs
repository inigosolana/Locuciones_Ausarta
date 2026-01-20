/** @type {import('next').NextConfig} */
const nextConfig = {
    // Esto es VITAL: obliga a Next.js a incluir el ejecutable de ffmpeg en el servidor
    experimental: {
      serverComponentsExternalPackages: ['ffmpeg-static'],
    },
  };
  
  export default nextConfig;
