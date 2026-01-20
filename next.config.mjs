/** @type {import('next').NextConfig} */
const nextConfig = {
  // En Next.js 15/16, esto va FUERA de 'experimental' y se llama 'serverExternalPackages'
  serverExternalPackages: ['ffmpeg-static', '@ffmpeg-installer/ffmpeg'],
  
  // (Opcional) Mantener compatibilidad si usas una versión < 15 en algún entorno
  experimental: {
    serverComponentsExternalPackages: ['ffmpeg-static', '@ffmpeg-installer/ffmpeg'],
  },
};

export default nextConfig;
