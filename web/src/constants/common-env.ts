const webConfig = {
    apiUrl: process.env.NODE_ENV === 'development' ? 'http://127.0.0.1:7000' : '',
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION || '1.0.0',
}

export default webConfig
