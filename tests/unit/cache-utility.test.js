const axios = require('axios');
const utilityHandler = require('../../src/handlers/utility-handler');
const redis = require('../../src/lib/redis-client');

jest.mock('axios');

describe('Utility Caching Tests', () => {
    const originalEnv = process.env;

    beforeEach(async () => {
        jest.resetAllMocks();
        // Limpar store do Redis Mock
        redis.store.clear();
        redis.expirations.clear();
        
        process.env = {
            ...originalEnv,
            OPENWEATHERMAP_API_KEY: 'test_weather_key',
            OMDB_API_KEY: 'test_movie_key',
            GEONAMES_USERNAME: 'test_geo_user',
            GOOGLE_API_KEY: 'test_google_key',
            GOOGLE_CSE_ID: 'test_cse_id'
        };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    test('should cache fetchWeather calls', async () => {
        const mockResponse1 = { name: 'Sao Paulo', main: { temp: 20 }, sys: { country: 'BR' }, weather: [{ description: 'nublado' }] };
        const mockResponse2 = { name: 'Sao Paulo', main: { temp: 25 }, sys: { country: 'BR' }, weather: [{ description: 'ensolarado' }] };

        // Configurar primeiro hit de rede
        axios.get.mockResolvedValueOnce({ data: mockResponse1 });

        // Primeiro call (deve bater na rede)
        const res1 = await utilityHandler.fetchWeather('Sao Paulo');
        expect(res1.main.temp).toBe(20);
        expect(axios.get).toHaveBeenCalledTimes(1);

        // Segundo call (deve retornar do cache, sem chamar axios novamente)
        axios.get.mockResolvedValueOnce({ data: mockResponse2 });
        const res2 = await utilityHandler.fetchWeather('Sao Paulo');
        expect(res2.main.temp).toBe(20); // Valor antigo vindo do cache
        expect(axios.get).toHaveBeenCalledTimes(1); // Fica em 1 chamada
    });

    test('should cache fetchMovie calls', async () => {
        const mockResponse1 = { Title: 'Matrix', Year: '1999', Response: 'True' };
        const mockResponse2 = { Title: 'Matrix', Year: '2003', Response: 'True' };

        axios.get.mockResolvedValueOnce({ data: mockResponse1 });

        const res1 = await utilityHandler.fetchMovie('Matrix');
        expect(res1.Year).toBe('1999');
        expect(axios.get).toHaveBeenCalledTimes(1);

        axios.get.mockResolvedValueOnce({ data: mockResponse2 });
        const res2 = await utilityHandler.fetchMovie('Matrix');
        expect(res2.Year).toBe('1999');
        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    test('should cache fetchCity calls', async () => {
        const mockResponse1 = { geonames: [{ name: 'Lisboa', countryName: 'Portugal' }] };
        const mockResponse2 = { geonames: [{ name: 'Porto', countryName: 'Portugal' }] };

        axios.get.mockResolvedValueOnce({ data: mockResponse1 });

        const res1 = await utilityHandler.fetchCity('Lisboa');
        expect(res1.name).toBe('Lisboa');
        expect(axios.get).toHaveBeenCalledTimes(1);

        axios.get.mockResolvedValueOnce({ data: mockResponse2 });
        const res2 = await utilityHandler.fetchCity('Lisboa');
        expect(res2.name).toBe('Lisboa');
        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    test('should cache googleSearch calls', async () => {
        const mockResponse1 = { items: [{ title: 'Termo 1', link: 'http://a' }] };
        const mockResponse2 = { items: [{ title: 'Termo 2', link: 'http://b' }] };

        axios.get.mockResolvedValueOnce({ data: mockResponse1 });

        const res1 = await utilityHandler.googleSearch('query');
        expect(res1[0].title).toBe('Termo 1');
        expect(axios.get).toHaveBeenCalledTimes(1);

        axios.get.mockResolvedValueOnce({ data: mockResponse2 });
        const res2 = await utilityHandler.googleSearch('query');
        expect(res2[0].title).toBe('Termo 1');
        expect(axios.get).toHaveBeenCalledTimes(1);
    });
});
