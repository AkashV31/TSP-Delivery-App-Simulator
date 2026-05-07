package src;

import com.sun.net.httpserver.HttpServer;
import com.sun.net.httpserver.HttpHandler;
import com.sun.net.httpserver.HttpExchange;

import java.io.*;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.*;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class BackendController {

    static class Location {
        double lat;
        double lng;
        public Location(double lat, double lng) {
            this.lat = lat;
            this.lng = lng;
        }
    }

    public static void main(String[] args) throws Exception {
        int port = 4567;
        HttpServer server = HttpServer.create(new InetSocketAddress(port), 0);
        server.createContext("/", new StaticFileHandler());
        server.createContext("/api/calculate-tsp", new TspHandler());
        server.setExecutor(null);
        server.start();
        System.out.println("BackendController Server started on port " + port);
    }

    // ─── Static File Server ──────────────────────────────────────────
    static class StaticFileHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            String path = exchange.getRequestURI().getPath();
            if (path.equals("/")) path = "/index.html";
            Path filePath = Paths.get("public", path);

            if (Files.exists(filePath) && !Files.isDirectory(filePath)) {
                byte[] response = Files.readAllBytes(filePath);
                String contentType = "text/plain";
                if (path.endsWith(".html")) contentType = "text/html; charset=utf-8";
                else if (path.endsWith(".css"))  contentType = "text/css; charset=utf-8";
                else if (path.endsWith(".js"))   contentType = "application/javascript; charset=utf-8";

                exchange.getResponseHeaders().set("Content-Type", contentType);
                exchange.sendResponseHeaders(200, response.length);
                try (OutputStream os = exchange.getResponseBody()) { os.write(response); }
            } else {
                exchange.sendResponseHeaders(404, -1);
            }
        }
    }

    // ─── TSP API Handler ────────────────────────────────────────────
    static class TspHandler implements HttpHandler {
        @Override
        public void handle(HttpExchange exchange) throws IOException {
            // CORS headers so browser can reach API
            exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");

            if ("OPTIONS".equals(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(204, -1);
                return;
            }

            if (!"POST".equals(exchange.getRequestMethod())) {
                exchange.sendResponseHeaders(405, -1);
                return;
            }

            String body = new String(exchange.getRequestBody().readAllBytes());

            // ── Parse locations ──
            List<Location> locs = new ArrayList<>();
            Matcher locM = Pattern.compile("\"lat\"\\s*:\\s*([0-9.]+)\\s*,\\s*\"lng\"\\s*:\\s*([0-9.]+)").matcher(body);
            while (locM.find()) locs.add(new Location(Double.parseDouble(locM.group(1)), Double.parseDouble(locM.group(2))));

            if (locs.isEmpty()) { sendErr(exchange, "No locations provided"); return; }

            // ── Parse options ──
            String mode = "driving";
            Matcher modeM = Pattern.compile("\"mode\"\\s*:\\s*\"([a-z]+)\"").matcher(body);
            if (modeM.find()) {
                String m = modeM.group(1);
                if (m.equals("scooter")) mode = "cycling";
                else if (m.equals("runner")) mode = "foot";
            }

            boolean simulateTraffic = body.contains("\"simulateTraffic\":true") || body.contains("\"simulateTraffic\": true");

            int startIndex = 0;
            Matcher startM = Pattern.compile("\"startIndex\"\\s*:\\s*([0-9]+)").matcher(body);
            if (startM.find()) startIndex = Integer.parseInt(startM.group(1));

            int visitedMask = 0;
            Matcher visitedM = Pattern.compile("\"visitedMask\"\\s*:\\s*([0-9]+)").matcher(body);
            if (visitedM.find()) visitedMask = Integer.parseInt(visitedM.group(1));

            long trafficSeed = -1L;
            Matcher seedM = Pattern.compile("\"trafficSeed\"\\s*:\\s*([0-9]+)").matcher(body);
            if (seedM.find()) trafficSeed = Long.parseLong(seedM.group(1));

            int n = locs.size();

            // ── Fetch OSRM distance matrix ──
            double[][] distMatrix = fetchOsrmMatrix(locs, mode);
            if (distMatrix == null) {
                System.out.println("OSRM matrix fetch failed, using Haversine fallback.");
                distMatrix = new double[n][n];
                for (int i = 0; i < n; i++)
                    for (int j = 0; j < n; j++)
                        distMatrix[i][j] = haversine(locs.get(i).lat, locs.get(i).lng, locs.get(j).lat, locs.get(j).lng) * 1000.0;
            }

            // Keep a clean copy of base (no-traffic) distances
            double[][] base = deepCopy(distMatrix, n);

            // ── Apply deterministic traffic ──
            String[][] trafficStatus = initStringMatrix(n, "green");
            double[][] trafficMult   = initDoubleMatrix(n, 1.0);

            if (simulateTraffic) {
                Random rng = (trafficSeed >= 0) ? new Random(trafficSeed) : new Random();
                for (int i = 0; i < n; i++) {
                    for (int j = i + 1; j < n; j++) {
                        double roll = rng.nextDouble();
                        double mult = 1.0;
                        String status = "green";
                        if (roll < 0.20)       { mult = 3.5; status = "red"; }
                        else if (roll < 0.50)  { mult = 2.0; status = "yellow"; }
                        distMatrix[i][j] = base[i][j] * mult;
                        distMatrix[j][i] = base[j][i] * mult;
                        trafficStatus[i][j] = trafficStatus[j][i] = status;
                        trafficMult[i][j]   = trafficMult[j][i]   = mult;
                    }
                }
            }

            try {
                String json = buildResponse(n, distMatrix, base, trafficStatus, trafficMult, startIndex, visitedMask, locs);
                byte[] bytes = json.getBytes("UTF-8");
                exchange.getResponseHeaders().set("Content-Type", "application/json; charset=utf-8");
                exchange.sendResponseHeaders(200, bytes.length);
                try (OutputStream os = exchange.getResponseBody()) { os.write(bytes); }
            } catch (Exception e) {
                e.printStackTrace();
                sendErr(exchange, e.getMessage());
            }
        }

        private void sendErr(HttpExchange ex, String msg) throws IOException {
            String res = "{\"error\":\"" + msg.replace("\"","'") + "\"}";
            byte[] b = res.getBytes("UTF-8");
            ex.getResponseHeaders().set("Content-Type", "application/json");
            ex.sendResponseHeaders(500, b.length);
            try (OutputStream os = ex.getResponseBody()) { os.write(b); }
        }
    }

    // ─── OSRM Matrix Fetch ──────────────────────────────────────────
    private static double[][] fetchOsrmMatrix(List<Location> locs, String mode) {
        try {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < locs.size(); i++) {
                if (i > 0) sb.append(';');
                sb.append(locs.get(i).lng).append(',').append(locs.get(i).lat);
            }
            URL url = new URL("https://router.project-osrm.org/table/v1/" + mode + "/" + sb + "?annotations=distance");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(10_000);
            conn.setReadTimeout(15_000);
            if (conn.getResponseCode() != 200) return null;

            StringBuilder resp = new StringBuilder();
            try (BufferedReader br = new BufferedReader(new InputStreamReader(conn.getInputStream()))) {
                String line;
                while ((line = br.readLine()) != null) resp.append(line);
            }
            return parseOsrmDistances(resp.toString(), locs.size());
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
    }

    /** Robust bracket-depth parsing of OSRM "distances":[[...]] */
    private static double[][] parseOsrmDistances(String json, int n) {
        int keyIdx = json.indexOf("\"distances\":");
        if (keyIdx == -1) return null;
        int outerOpen = json.indexOf('[', keyIdx);
        if (outerOpen == -1) return null;

        // Walk to matching closing bracket
        int depth = 0, outerClose = -1;
        for (int i = outerOpen; i < json.length(); i++) {
            char c = json.charAt(i);
            if (c == '[') depth++;
            else if (c == ']' && --depth == 0) { outerClose = i; break; }
        }
        if (outerClose == -1) return null;

        double[][] matrix = new double[n][n];
        int row = 0, i = outerOpen + 1;
        while (i < outerClose && row < n) {
            if (json.charAt(i) != '[') { i++; continue; }
            int rowClose = json.indexOf(']', i);
            if (rowClose == -1) break;
            String[] parts = json.substring(i + 1, rowClose).split(",");
            for (int j = 0; j < n && j < parts.length; j++) {
                String v = parts[j].trim();
                matrix[row][j] = v.equals("null") ? Double.MAX_VALUE / 2 : Double.parseDouble(v);
            }
            row++;
            i = rowClose + 1;
        }
        return matrix;
    }

    // ─── Response Builder ───────────────────────────────────────────
    private static String buildResponse(int n, double[][] dist, double[][] base,
                                        String[][] traffic, double[][] mult,
                                        int startIndex, int visitedMask,
                                        List<Location> locs) throws Exception {

        // ── Solve TSP ──
        int[] tspPath = runJavaTsp(n, dist, startIndex, visitedMask);

        // ── Compute naive route (selection order: 0,1,2,...,n-1,0) ──
        // Naive = visiting unvisited nodes in index order from startIndex
        List<Integer> naiveOrder = new ArrayList<>();
        naiveOrder.add(startIndex);
        for (int i = 0; i < n; i++) {
            if (i != startIndex && (visitedMask & (1 << i)) == 0)
                naiveOrder.add(i);
        }
        if (naiveOrder.get(naiveOrder.size()-1) != 0) naiveOrder.add(0);

        double naiveDist = 0, tspDist = 0;
        for (int i = 0; i < naiveOrder.size()-1; i++)
            naiveDist += base[naiveOrder.get(i)][naiveOrder.get(i+1)];
        for (int i = 0; i < tspPath.length-1; i++)
            tspDist += base[tspPath[i]][tspPath[i+1]];

        // ── Build JSON manually ──
        StringBuilder sb = new StringBuilder("{");

        // sequence
        sb.append("\"sequence\":[");
        for (int i = 0; i < tspPath.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(tspPath[i]);
        }
        sb.append("],");

        // naive sequence
        sb.append("\"naiveSequence\":[");
        for (int i = 0; i < naiveOrder.size(); i++) {
            if (i > 0) sb.append(',');
            sb.append(naiveOrder.get(i));
        }
        sb.append("],");

        // costs (in meters)
        sb.append("\"tspDistMeters\":").append(String.format("%.1f", tspDist)).append(',');
        sb.append("\"naiveDistMeters\":").append(String.format("%.1f", naiveDist)).append(',');

        // per-leg base distances for the TSP path
        sb.append("\"legDistances\":[");
        for (int i = 0; i < tspPath.length-1; i++) {
            if (i > 0) sb.append(',');
            sb.append(String.format("%.1f", base[tspPath[i]][tspPath[i+1]]));
        }
        sb.append("],");

        // traffic statuses per leg
        sb.append("\"traffic\":[");
        for (int i = 0; i < tspPath.length-1; i++) {
            if (i > 0) sb.append(',');
            sb.append('"').append(traffic[tspPath[i]][tspPath[i+1]]).append('"');
        }
        sb.append("],");

        // traffic multipliers per leg
        sb.append("\"trafficMultipliers\":[");
        for (int i = 0; i < tspPath.length-1; i++) {
            if (i > 0) sb.append(',');
            sb.append(String.format("%.2f", mult[tspPath[i]][tspPath[i+1]]));
        }
        sb.append("]}");

        return sb.toString();
    }

    // ─── Haversine ──────────────────────────────────────────────────
    private static double haversine(double lat1, double lon1, double lat2, double lon2) {
        final int R = 6371;
        double dLat = Math.toRadians(lat2 - lat1), dLon = Math.toRadians(lon2 - lon1);
        double a = Math.sin(dLat/2)*Math.sin(dLat/2)
                 + Math.cos(Math.toRadians(lat1))*Math.cos(Math.toRadians(lat2))
                 * Math.sin(dLon/2)*Math.sin(dLon/2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); // km
    }

    // ─── TSP DP Solver ──────────────────────────────────────────────
    private static int[] runJavaTsp(int N, double[][] dist, int startIndex, int visitedMask) {
        if (N <= 1) return new int[]{0};

        int unvisited = 0;
        for (int i = 0; i < N; i++)
            if (i != startIndex && (visitedMask & (1<<i)) == 0) unvisited++;
        if (unvisited == 0)
            return (startIndex == 0) ? new int[]{0} : new int[]{startIndex, 0};

        int FULL = (1 << N) - 1;
        double[][] dp = new double[1<<N][N];
        int[][] par   = new int   [1<<N][N];
        for (double[] row : dp) Arrays.fill(row, Double.MAX_VALUE / 2);
        for (int[]   row : par) Arrays.fill(row, -1);

        int startMask = (1<<startIndex) | visitedMask;
        dp[startMask][startIndex] = 0;

        for (int mask = 1; mask < (1<<N); mask++) {
            if ((mask & startMask) != startMask) continue;
            for (int u = 0; u < N; u++) {
                if ((mask & (1<<u)) == 0 || dp[mask][u] >= Double.MAX_VALUE/3) continue;
                for (int v = 0; v < N; v++) {
                    if ((mask & (1<<v)) != 0) continue;
                    int next = mask | (1<<v);
                    double nd = dp[mask][u] + dist[u][v];
                    if (nd < dp[next][v]) { dp[next][v] = nd; par[next][v] = u; }
                }
            }
        }

        // Find best last node (returning to 0)
        double best = Double.MAX_VALUE;
        int lastNode = -1;
        for (int i = 0; i < N; i++) {
            if (i == 0 || (visitedMask & (1<<i)) != 0) continue;
            double c = dp[FULL][i] + dist[i][0];
            if (c < best) { best = c; lastNode = i; }
        }
        if (lastNode == -1) return (startIndex == 0) ? new int[]{0} : new int[]{startIndex, 0};

        // Trace back path
        List<Integer> path = new ArrayList<>();
        int curr = lastNode, curMask = FULL;
        while (curr != -1 && curr != startIndex) {
            path.add(curr);
            int p = par[curMask][curr];
            curMask ^= (1<<curr);
            curr = p;
        }
        path.add(startIndex);
        Collections.reverse(path);
        if (path.get(path.size()-1) != 0) path.add(0);

        return path.stream().mapToInt(Integer::intValue).toArray();
    }

    // ─── Utilities ──────────────────────────────────────────────────
    private static double[][] deepCopy(double[][] src, int n) {
        double[][] dst = new double[n][n];
        for (int i = 0; i < n; i++) System.arraycopy(src[i], 0, dst[i], 0, n);
        return dst;
    }
    private static String[][] initStringMatrix(int n, String val) {
        String[][] m = new String[n][n];
        for (String[] r : m) Arrays.fill(r, val);
        return m;
    }
    private static double[][] initDoubleMatrix(int n, double val) {
        double[][] m = new double[n][n];
        for (double[] r : m) Arrays.fill(r, val);
        return m;
    }
}
