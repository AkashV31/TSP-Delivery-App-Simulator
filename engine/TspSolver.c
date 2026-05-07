#include <stdio.h>
#include <stdlib.h>
#include <float.h>

#define MAX_N 15

int N;
double dist[MAX_N][MAX_N];
int best_path[MAX_N];
double min_cost = DBL_MAX;

// Recursive Bruteforce TSP with Branch and Bound
// Extremely fast for N <= 11
void tsp(int node, int count, double current_cost, int* current_path, int visited) {
    if (count == N) {
        // Return to start
        double total_cost = current_cost + dist[node][0];
        if (total_cost < min_cost) {
            min_cost = total_cost;
            for (int i = 0; i < N; i++) {
                best_path[i] = current_path[i];
            }
        }
        return;
    }

    if (current_cost >= min_cost) return;

    for (int i = 1; i < N; i++) {
        if ((visited & (1 << i)) == 0) {
            current_path[count] = i;
            tsp(i, count + 1, current_cost + dist[node][i], current_path, visited | (1 << i));
        }
    }
}

int main() {
    if (scanf("%d", &N) != 1) return 1;

    for (int i = 0; i < N; i++) {
        for (int j = 0; j < N; j++) {
            if (scanf("%lf", &dist[i][j]) != 1) return 1;
        }
    }

    int current_path[MAX_N];
    current_path[0] = 0; 
    int visited = 1;     

    tsp(0, 1, 0.0, current_path, visited);

    for (int i = 0; i < N; i++) {
        printf("%d,", best_path[i]);
    }
    printf("0\n"); 

    return 0;
}
