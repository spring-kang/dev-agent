/** @type {import('next').NextConfig} */
const nextConfig = {
  // API 프록시 설정 (개발 환경에서 CORS 회피)
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: "http://localhost:3001/api/:path*",
      },
    ];
  },
};

export default nextConfig;
