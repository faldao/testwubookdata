import express from 'express';
import axios from 'axios';
import qs from 'qs';
import dotenv from 'dotenv';
dotenv.config();

const app = express();
app.use(express.json());


console.log('Loaded environment variables:', process.env);

// Verificar si la variable de entorno se ha cargado
console.log(`WUBOOK_API_KEY IS: ${process.env.WUBOOK_API_KEY}`);

const calculateDaysBetween = (arrival, departure) => {
    const [dayA, monthA, yearA] = arrival.split('/');
    const [dayD, monthD, yearD] = departure.split('/');
    const arrivalDate = new Date(yearA, monthA - 1, dayA);
    const departureDate = new Date(yearD, monthD - 1, dayD);
    return (departureDate - arrivalDate) / (1000 * 60 * 60 * 24);
};

app.post('/fetch_wubook_data', async (req, res) => {
    const { arrival, departure } = req.body;
    if (!arrival || !departure) {
        return res.status(400).json({ error: 'Invalid request, arrival and departure dates are required.' });
    }

    const headers = {
        'x-api-key': process.env.WUBOOK_API_KEY,
        'Content-Type': 'application/x-www-form-urlencoded'
    };

    const base_url = "https://kapi.wubook.net/kp";
    const rate_id = 37166;
    const images_url = "https://candallarq57078.ipage.com/images/";

    console.log(`Incoming request with arrival: ${arrival}, departure: ${departure}`);
    console.log(`Configured headers with API Key:`, headers);

    try {
        // Fetch products and availability in parallel
        const [responseProducts, responseAvailability] = await Promise.all([
            axios.post(`${base_url}/property/fetch_products`, {}, { headers }),
            axios.post(`${base_url}/inventory/fetch_rooms_availability`, qs.stringify({ arrival, departure }), { headers })
        ]);

        const productsData = responseProducts.data.data || [];
        const availabilityData = responseAvailability.data.data || {};

        console.log('Products Data:', productsData);
        console.log('Availability Data:', availabilityData);

        const productMap = productsData.reduce((acc, product) => {
            if (product.master === 1) {
                acc[product.id_zak_room_type] = product;
            }
            return acc;
        }, {});

        console.log('Product Map:', productMap);

        const room_nights = calculateDaysBetween(arrival, departure);
        const ratesRequests = [];

        for (const [roomTypeId, product] of Object.entries(productMap)) {
            if (availabilityData[roomTypeId] && availabilityData[roomTypeId].rooms > 0) {
                ratesRequests.push(
                    axios.post(`${base_url}/inventory/fetch_rate_values`, null, {
                        params: {
                            from: arrival,
                            rate: rate_id,
                            n: room_nights
                        },
                        headers
                    })
                    .then(rateResponse => {
                        console.log(`Rates for product ${product.id}:`, rateResponse.data);
                        const rateData = rateResponse.data.data[product.id];
                        const totalRate = rateData ? Math.round(rateData.reduce((acc, rate) => acc + rate.p, 0)) : 0;
                        return {
                            product_id: product.id,
                            room_type_id: product.id_zak_room_type,
                            product_name: product.name,
                            short_room_name: product.srname,
                            room_name: product.rname,
                            room_image_url: `${images_url}${product.id_zak_property}_${product.srname}.jpg`,
                            totalRate: `${totalRate} USD`,
                            availableRooms: availabilityData[roomTypeId].rooms
                        };
                    })
                    .catch(error => {
                        console.error(`Error fetching rate values for room type ID ${roomTypeId}:`, error);
                        return null;
                    })
                );
            }
        }

        const ratesResults = await Promise.all(ratesRequests);
        const resultsWithAvailability = ratesResults.filter(result => result != null);
        console.log('Results with Availability:', resultsWithAvailability);
        res.json({ resultsWithAvailability });
    } catch (error) {
        console.error('Error fetching data:', error);
        res.status(500).json({ error: error.message });
    }
});

const convertirFecha = (fechaString) => {
    const partes = fechaString.split("/");
    const dia = parseInt(partes[0], 10);
    const mes = parseInt(partes[1], 10) - 1;
    const anio = parseInt(partes[2], 10);
    const fecha = new Date(anio, mes, dia);
    if (fecha.getDate() !== dia || fecha.getMonth() !== mes || fecha.getFullYear() !== anio) {
        return null;
    }
    return fecha;
};

const esFechaValidaYMayorQueHoy = (data) => {
    const fechaString = data.fechaString;
    const fecha = convertirFecha(fechaString);
    if (!fecha) {
        return false;
    }
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    return fecha > hoy ? "verdadero" : "falso";
};

const esDepartureMayorQueArrival = (data) => {
    const { arrivalString, departureString } = data;

    if (!/^\d{2}\/\d{2}\/\d{4}$/.test(arrivalString) || !/^\d{2}\/\d{2}\/\d{4}$/.test(departureString)) {
        return false;
    }

    const arrivalDate = convertirFecha(arrivalString);
    const departureDate = convertirFecha(departureString);

    if (!arrivalDate || !departureDate || departureDate <= arrivalDate) {
        return false;
    }

    return true;
};

app.post('/validate_date', (req, res) => {
    const result = esFechaValidaYMayorQueHoy(req.body);
    res.json({ valid: result });
});

app.post('/validate_dates', (req, res) => {
    const isValid = esDepartureMayorQueArrival(req.body);
    res.json({ valid: isValid });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});