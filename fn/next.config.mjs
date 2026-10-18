/** @type {import('next').NextConfig} */
const nextConfig = {
    output:'export',
    experimental: {
        missingSuspenseWithCSRBailout: false,
      },
    trailingSlash: true,
     images: {
    unoptimized: true, // required for static export if using next/image
  },
  assetPrefix: process.env.NODE_ENV === 'production' ? './' : '/',

};

export default nextConfig;
